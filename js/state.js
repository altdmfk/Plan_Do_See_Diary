/**
 * Plan-Do-See Diary - Centralized Reactive State Store (Observer Pattern)
 * Features optimistic UI updates and automated error rollback.
 */

import { CONFIG } from './config.js';
import { API } from './api.js';
import { getKSTToday, isDelayedKST } from './dateUtils.js';

class StateStore {
  constructor() {
    this.listeners = new Set();
    const savedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem(CONFIG.STORAGE_KEYS.ACTIVE_THEME) : null;
    this.state = {
      theme: savedTheme || CONFIG.DEFAULT_THEME,
      plans: [],
      plan_histories: [],
      todos: [],
      do_logs: [],
      see_reviews: [],
      selectedPlanId: null,
      filters: {
        planId: '', // '' = all plans, or specific planId
        planPriority: 'all', // Dedicated Plan priority filter (all, urgent, high, medium, low)
        planSort: 'created_desc', // Plan sort: created_desc, end_asc, start_asc, priority_desc
        search: '',
        priority: 'all', // Dedicated Do priority filter (all, urgent, high, medium, low)
        tags: [], // Multi-tag array support
        status: 'all',
        sort: 'due_asc' // Do sort: due_asc, priority_desc, created_desc
      },
      activeMobileTab: 'plan', // 'plan' | 'do' | 'see'
      loading: false
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('Listener notification error', err);
      }
    }
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  async init() {
    this.state.loading = true;
    this.notify();
    try {
      await this.refreshData();
    } finally {
      this.state.loading = false;
      this.notify();
    }
  }

  async refreshData() {
    const data = await API.fetchAll();
    this.state.plans = data.plans || [];
    this.state.plan_histories = data.plan_histories || [];
    this.state.todos = data.todos || [];
    this.state.do_logs = data.do_logs || [];
    this.state.see_reviews = data.see_reviews || [];

    if (!this.state.selectedPlanId && this.state.plans.length > 0) {
      this.state.selectedPlanId = this.state.plans[0].id;
    } else if (this.state.plans.length === 0) {
      this.state.selectedPlanId = null;
    }
    this.notify();
  }

  clearAll() {
    this.state.plans = [];
    this.state.plan_histories = [];
    this.state.todos = [];
    this.state.do_logs = [];
    this.state.see_reviews = [];
    this.state.selectedPlanId = null;
    this.notify();
  }

  setTheme(newTheme) {
    this.state.theme = newTheme;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CONFIG.STORAGE_KEYS.ACTIVE_THEME, newTheme);
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-theme', newTheme);
    }
    this.notify();
  }

  setSelectedPlan(planId) {
    this.state.selectedPlanId = planId;
    this.notify();
  }

  setFilters(partialFilters) {
    this.state.filters = { ...this.state.filters, ...partialFilters };
    this.notify();
  }

  toggleTagFilter(tag) {
    const currentTags = [...(this.state.filters.tags || [])];
    const index = currentTags.indexOf(tag);
    if (index > -1) {
      currentTags.splice(index, 1);
    } else {
      currentTags.push(tag);
    }
    this.setFilters({ tags: currentTags });
  }

  clearTagFilters() {
    this.setFilters({ tags: [] });
  }

  setMobileTab(tab) {
    if (['plan', 'do', 'see'].includes(tab)) {
      this.state.activeMobileTab = tab;
      this.notify();
    }
  }

  // --- OPTIMISTIC UI OPERATIONS ---

  async optimisticUpdateTodo(todoId, updates, apiCall) {
    const previousTodos = JSON.parse(JSON.stringify(this.state.todos));
    const target = this.state.todos.find(t => t.id === todoId);
    if (target) {
      Object.assign(target, updates);
      this.notify();
    }

    try {
      const result = await apiCall();
      await this.refreshData();
      return result;
    } catch (err) {
      this.state.todos = previousTodos;
      this.notify();
      throw err;
    }
  }

  // --- KST ANALYTICS CALCULATOR ---

  getKSTMetrics(planId = this.state.selectedPlanId) {
    const activeTodos = this.state.todos.filter(t => !planId || t.plan_id === planId);
    const plannedCount = activeTodos.length;
    const completedCount = activeTodos.filter(t => t.is_completed).length;

    let delayedCount = 0;
    for (const todo of activeTodos) {
      const isDateDelayed = isDelayedKST(todo.due_date, todo.is_completed);
      const todoLogs = this.state.do_logs.filter(l => String(l.todo_id) === String(todo.id));
      const actualMin = todoLogs.reduce((sum, l) => sum + (Number(l.actual_minutes) || 0), 0);
      const isTimeOverrun = actualMin > (parseInt(todo.estimated_minutes, 10) || 0);
      if (isDateDelayed || isTimeOverrun) {
        delayedCount++;
      }
    }

    const blockedTodoIds = new Set();
    for (const log of this.state.do_logs) {
      if (log.blocked_reason && log.blocked_reason.trim().length > 0) {
        if (activeTodos.some(t => t.id === log.todo_id)) {
          blockedTodoIds.add(log.todo_id);
        }
      }
    }
    const blockedCount = blockedTodoIds.size;

    let totalEstimatedMin = 0;
    for (const todo of activeTodos) {
      totalEstimatedMin += (parseInt(todo.estimated_minutes, 10) || 0);
    }

    let totalActualMin = 0;
    for (const log of this.state.do_logs) {
      if (activeTodos.some(t => t.id === log.todo_id)) {
        totalActualMin += (parseInt(log.actual_minutes, 10) || 0);
      }
    }

    const timeDeltaMinutes = totalActualMin - totalEstimatedMin;

    return {
      plannedCount,
      completedCount,
      delayedCount,
      blockedCount,
      totalEstimatedMin,
      totalActualMin,
      timeDeltaMinutes
    };
  }

  // --- GET FILTERED PLANS (Includes plans with matching child To Dos) ---

  getFilteredPlans() {
    let list = this.state.plans;
    const { search, planPriority, planId, planSort } = this.state.filters;

    if (planId && planId !== '' && planId !== 'all') {
      list = list.filter(p => String(p.id) === String(planId));
    }

    if (planPriority && planPriority !== 'all') {
      list = list.filter(p => p.priority === planPriority);
    }

    if (search && search.trim() !== '') {
      const q = search.trim().toLowerCase();
      const matchingTodoPlanIds = new Set(
        this.state.todos
          .filter(t => 
            (t.title && t.title.toLowerCase().includes(q)) ||
            (t.description && t.description.toLowerCase().includes(q)) ||
            (t.tags && t.tags.some(tg => tg.toLowerCase().includes(q)))
          )
          .map(t => t.plan_id)
      );

      list = list.filter(p => 
        (p.title && p.title.toLowerCase().includes(q)) ||
        (p.success_criteria && p.success_criteria.toLowerCase().includes(q)) ||
        matchingTodoPlanIds.has(p.id)
      );
    }

    const priorityWeights = { urgent: 4, high: 3, medium: 2, low: 1 };
    const sortMode = planSort || 'created_desc';
    list.sort((a, b) => {
      if (sortMode === 'end_asc') {
        return (a.period_end || '').localeCompare(b.period_end || '');
      } else if (sortMode === 'start_asc') {
        return (a.period_start || '').localeCompare(b.period_start || '');
      } else if (sortMode === 'priority_desc') {
        return (priorityWeights[b.priority] || 0) - (priorityWeights[a.priority] || 0);
      }
      return (b.created_at || '').localeCompare(a.created_at || '');
    });

    return list;
  }

  // --- GET FILTERED TODOS (Multi-tag filtering support) ---

  getFilteredTodos() {
    let list = this.state.todos;
    if (this.state.selectedPlanId) {
      list = list.filter(t => t.plan_id === this.state.selectedPlanId);
    }

    const { search, priority, tags, status, sort } = this.state.filters;

    if (search && search.trim() !== '') {
      const q = search.trim().toLowerCase();
      list = list.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.description && t.description.toLowerCase().includes(q)) ||
        (t.tags && t.tags.some(tg => tg.toLowerCase().includes(q)))
      );
    }

    if (priority && priority !== 'all') {
      list = list.filter(t => t.priority === priority);
    }

    // Multi-tag match: matches if todo contains any of the selected tags (or all of them)
    if (tags && tags.length > 0) {
      list = list.filter(t => t.tags && tags.every(tg => t.tags.includes(tg)));
    }

    if (status === 'completed') {
      list = list.filter(t => t.is_completed);
    } else if (status === 'in_progress') {
      list = list.filter(t => !t.is_completed);
    } else if (status === 'delayed') {
      list = list.filter(t => {
        const isDateDelayed = isDelayedKST(t.due_date, t.is_completed);
        const todoLogs = this.state.do_logs.filter(l => String(l.todo_id) === String(t.id));
        const actualMin = todoLogs.reduce((sum, l) => sum + (Number(l.actual_minutes) || 0), 0);
        const isTimeOverrun = actualMin > (parseInt(t.estimated_minutes, 10) || 0);
        return isDateDelayed || isTimeOverrun;
      });
    }

    const priorityWeights = { urgent: 4, high: 3, medium: 2, low: 1 };
    const todoSort = sort || 'due_asc';
    list.sort((a, b) => {
      if (todoSort === 'priority_desc') {
        return (priorityWeights[b.priority] || 0) - (priorityWeights[a.priority] || 0);
      } else if (todoSort === 'created_desc') {
        return (b.created_at || '').localeCompare(a.created_at || '');
      }
      return (a.due_date || '').localeCompare(b.due_date || '');
    });

    return list;
  }
}

export const appState = new StateStore();
