/**
 * Plan-Do-See Diary - Centralized Reactive State Store (Observer Pattern)
 * Features optimistic UI updates and automated error rollback.
 */

import { CONFIG } from '../core/config.js';
import { authClient } from '../auth/auth.js';
import { API } from '../api/api.js';
import { getKSTToday, isDelayedKST } from '../utils/dateUtils.js';

class StateStore {
  constructor() {
    this.listeners = new Set();
    const uid = typeof authClient !== 'undefined' && typeof authClient.getUserId === 'function' ? authClient.getUserId() : null;
    const userSavedTheme = uid && typeof localStorage !== 'undefined' ? localStorage.getItem(`pds_theme_${uid}`) : null;
    const savedTheme = typeof localStorage !== 'undefined' ? (userSavedTheme || localStorage.getItem('pds_theme_pref') || localStorage.getItem(CONFIG.STORAGE_KEYS.ACTIVE_THEME) || CONFIG.DEFAULT_THEME) : CONFIG.DEFAULT_THEME;
    this.state = {
      theme: savedTheme || CONFIG.DEFAULT_THEME,
      plans: [],
      plan_histories: [],
      todos: [],
      do_logs: [],
      see_reviews: [],
      reviews: [],
      selectedPlanId: null,
      filters: {
        planId: '',
        planPriority: 'all',
        planStatus: 'all',
        planSort: 'created_desc',
        planPage: 1,
        planPageSize: CONFIG.PLAN_PAGE_SIZE || 10,
        search: '',
        priority: 'all',
        tags: [],
        status: 'all',
        sort: 'due_asc'
      },
      activeMobileTab: 'plan',
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
    return await this.refreshData();
  }

  async refreshData() {
    this.state.loading = true;
    this.notify();
    try {
      // Ensure authenticated session is hydrated before initial or refreshed data fetch
      if (typeof authClient !== 'undefined' && typeof authClient.getSession === 'function') {
        await authClient.getSession();
      }
      const data = await API.fetchAll();
      this.state.plans = data.plans || [];
      this.state.plan_histories = data.plan_histories || [];
      this.state.todos = data.todos || [];
      this.state.do_logs = data.do_logs || [];
      this.state.see_reviews = data.see_reviews || [];
      this.state.reviews = data.see_reviews || [];

      if (!this.state.selectedPlanId && this.state.plans.length > 0) {
        this.state.selectedPlanId = this.state.plans[0].id;
      } else if (this.state.plans.length === 0) {
        this.state.selectedPlanId = null;
      }
    } finally {
      this.state.loading = false;
      this.notify();
    }
  }

  reset() {
    this.clearAll();
  }

  clearAll() {
    this.state.plans = [];
    this.state.plan_histories = [];
    this.state.todos = [];
    this.state.do_logs = [];
    this.state.see_reviews = [];
    this.state.reviews = [];
    this.state.selectedPlanId = null;
    this.state.filters = { search: '', priority: 'all', tags: [], planId: null, planPage: 1 };
    this.notify();
  }

  // Alias for explicit cross-session state reset (Defect 3: prevents data flash on account switch)
  resetGlobalState() {
    this.clearAll();
  }

  setTheme(newTheme) {
    this.state.theme = newTheme;
    if (typeof localStorage !== 'undefined') {
      const uid = authClient.getUserId();
      if (uid) {
        localStorage.setItem(`pds_theme_${uid}`, newTheme);
      }
      localStorage.setItem('pds_theme_pref', newTheme);
      localStorage.setItem(CONFIG.STORAGE_KEYS.ACTIVE_THEME, newTheme);
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-theme', newTheme);
    }
    this.notify();
  }

  setSelectedPlan(planId) {
    this.state.selectedPlanId = planId || null;
    this.notify();
  }

  getTodoActualMinutes(todoId) {
    const logs = (this.state.do_logs || []).filter(l => String(l.todo_id) === String(todoId));
    return logs.reduce((sum, l) => sum + (Number(l.actual_minutes || l.duration_minutes) || 0), 0);
  }

  setFilters(partialFilters) {
    const currentFilters = this.state.filters || {};
    const isPlanFilterChanging = (
      ('search' in partialFilters && partialFilters.search !== currentFilters.search) ||
      ('planPriority' in partialFilters && partialFilters.planPriority !== currentFilters.planPriority) ||
      ('planStatus' in partialFilters && partialFilters.planStatus !== currentFilters.planStatus) ||
      ('planSort' in partialFilters && partialFilters.planSort !== currentFilters.planSort) ||
      ('planId' in partialFilters && partialFilters.planId !== currentFilters.planId)
    );

    // When filters or search queries change, automatically reset current page back to page 1
    if (isPlanFilterChanging && !('planPage' in partialFilters)) {
      partialFilters.planPage = 1;
    }

    this.state.filters = { ...this.state.filters, ...partialFilters };
    this.notify();
  }

  setPlanPage(page) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    this.setFilters({ planPage: p });
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
    const plans = this.state.plans || [];
    const todos = this.state.todos || [];
    const activePlans = plans.filter(p => !p.archived && !p.is_deleted);
    const relevantPlans = planId ? activePlans.filter(p => String(p.id) === String(planId)) : activePlans;
    const activeTodos = todos.filter(t => !t.is_deleted && (!planId || String(t.plan_id) === String(planId)));
    
    // 1. 계획 건수 (Plan Count):
    // Definition: The total number of all currently incomplete ToDo items (!is_completed).
    const plannedCount = activeTodos.filter(t => !t.is_completed).length;

    // 2. 완료 건수
    const completedCount = activeTodos.filter(t => t.is_completed).length;

    const doLogs = this.state.do_logs || [];

    // 3. 지연 수 (Overdue Count, Strict T06-C30 Compliance):
    // Definition: Unique ToDo items that are NOT completed AND whose deadline is strictly before KST today.
    const today = getKSTToday();
    const delayedCount = activeTodos.filter(t => !t.is_completed && t.due_date < today).length;

    const blockedTodoIds = new Set();
    for (const log of doLogs) {
      if (log.blocked_reason && log.blocked_reason.trim().length > 0) {
        if (activeTodos.some(t => String(t.id) === String(log.todo_id))) {
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
    for (const log of doLogs) {
      if (activeTodos.some(t => String(t.id) === String(log.todo_id))) {
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
      timeDeltaMinutes,
      totalPlansCount: relevantPlans.length,
      totalTodosCount: activeTodos.length
    };
  }

  // --- GET FILTERED PLANS (Includes plans with matching child To Dos) ---

  getFilteredPlans() {
    let list = this.state.plans || [];
    const allPlans = this.state.plans || [];
    const todos = this.state.todos || [];
    const { search, planPriority, planStatus, planId, planSort } = this.state.filters || {};

    if (planId && planId !== '' && planId !== 'all') {
      list = list.filter(p => String(p.id) === String(planId));
    }

    if (planPriority && planPriority !== 'all') {
      list = list.filter(p => p.priority === planPriority);
    }

    if (planStatus && planStatus !== 'all') {
      list = list.filter(p => {
        const isFeedbackConverted = allPlans.some(ap => ap.source_plan_id === p.id || ap.parent_plan_id === p.id);
        const pTodos = todos.filter(t => String(t.plan_id) === String(p.id));
        const allDosCompleted = pTodos.length > 0 && pTodos.every(t => t.is_completed || t.status === 'completed');
        const hasIncompleteDos = pTodos.some(t => !t.is_completed && t.status !== 'completed');

        let isCompleted = false;
        if (p.status === 'completed' || p.is_completed === true || allDosCompleted || isFeedbackConverted) {
          isCompleted = true;
        } else {
          isCompleted = false;
        }

        if (planStatus === 'completed') {
          return isCompleted;
        } else if (planStatus === 'in_progress' || planStatus === 'active') {
          return !isCompleted;
        }
        return true;
      });
    }

    if (search && search.trim() !== '') {
      const q = search.trim().toLowerCase();
      const matchingTodoPlanIds = new Set(
        (this.state.todos || [])
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
      } else if (sortMode === 'status') {
        const statusWeights = { draft: 1, pending: 1, active: 2, in_progress: 2, completed: 3, archived: 4 };
        return (statusWeights[a.status] || 99) - (statusWeights[b.status] || 99);
      }
      return (b.created_at || '').localeCompare(a.created_at || '');
    });

    return list;
  }

  // --- GET PAGINATED PLANS (Client/Server-side pagination with auto-page recovery) ---

  getPaginatedPlans() {
    const allFiltered = this.getFilteredPlans();
    const pageSize = this.state.filters.planPageSize || CONFIG.PLAN_PAGE_SIZE || 10;
    const totalItems = allFiltered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    
    // Auto-adjust page if current page exceeds totalPages (e.g. after item deletion)
    let currentPage = Math.min(Math.max(1, this.state.filters.planPage || 1), totalPages);
    if (currentPage !== this.state.filters.planPage) {
      this.state.filters.planPage = currentPage;
    }

    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageItems = allFiltered.slice(startIndex, endIndex);

    return {
      items: pageItems,
      totalItems,
      totalPages,
      currentPage,
      pageSize,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1
    };
  }

  // --- GET FILTERED TODOS (Multi-tag filtering support) ---

  getFilteredTodos() {
    let list = [...(this.state.todos || [])];
    if (this.state.selectedPlanId) {
      list = list.filter(t => t.plan_id === this.state.selectedPlanId);
    }

    const { search, priority, tags, status, sort } = this.state.filters || {};

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

    // Multi-tag match
    if (tags && tags.length > 0) {
      list = list.filter(t => t.tags && tags.every(tg => t.tags.includes(tg)));
    }

    if (status === 'completed') {
      list = list.filter(t => t.is_completed);
    } else if (status === 'in_progress') {
      list = list.filter(t => !t.is_completed);
    } else if (status === 'delayed') {
      const doLogs = this.state.do_logs || [];
      list = list.filter(t => {
        if (t.is_completed) return false;
        const isDateDelayed = isDelayedKST(t.due_date, t.is_completed);
        const todoLogs = doLogs.filter(l => String(l.todo_id) === String(t.id));
        const actualMin = todoLogs.reduce((sum, l) => sum + (Number(l.actual_minutes) || 0), 0);
        const isTimeOverrun = actualMin > (parseInt(t.estimated_minutes, 10) || 0);
        return isDateDelayed || isTimeOverrun;
      });
    }

    const priorityWeights = { urgent: 4, high: 3, medium: 2, low: 1 };
    const todoSort = sort || 'due_asc';
    list.sort((a, b) => {
      if (todoSort === 'priority_desc') {
        const diff = (priorityWeights[b.priority] || 0) - (priorityWeights[a.priority] || 0);
        if (diff !== 0) return diff;
      } else if (todoSort === 'created_desc') {
        const diff = (b.created_at || '').localeCompare(a.created_at || '');
        if (diff !== 0) return diff;
      } else if (todoSort === 'due_asc') {
        const diff = (a.due_date || '').localeCompare(b.due_date || '');
        if (diff !== 0) return diff;
      }
      
      // Deterministic & Stable tie-breaking
      const sortOrderDiff = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (sortOrderDiff !== 0) return sortOrderDiff;
      const createdAtDiff = (a.created_at || '').localeCompare(b.created_at || '');
      if (createdAtDiff !== 0) return createdAtDiff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    return list;
  }
}

export const appState = new StateStore();
