/**
 * Plan-Do-See Diary - Main Orchestrator & Event Controller
 */

import { CONFIG } from './config.js';
import { appState } from './state.js';
import { API } from './api.js';
import { getKSTToday, formatKSTLiveClock } from './dateUtils.js';
import { i18n } from './i18n.js';
import {
  escapeHtml,
  showToast,
  modalManager,
  setupAutoTextarea,
  updateFaviconAndBrand,
  applyLanguageTranslations,
  renderPlanColumn,
  renderDoColumn,
  renderSeeColumn,
  renderPlanHistoryModal
} from './ui.js';

// Timer tracking state for Do Execution Logger
const timerState = {
  intervalId: null,
  startEpoch: null,
  elapsedSeconds: 0,
  isRunning: false
};

const activeCheckboxToggles = new Set();

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initLanguage();
  setupAutoExpandingTextareas();
  bindHeaderControls();
  bindFilterControls();
  bindBoardActions();
  bindModalForms();
  bindPriorityPills();
  bindInputValidations();
  bindKeyboardShortcuts();
  bindMobileTouchGestures();
  startLiveKstClock();

  // Subscribe state store to UI updates
  appState.subscribe(onStateChange);

  // Initialize data store
  await appState.init();
});

function initTheme() {
  const currentTheme = appState.getState().theme;
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeButtons(currentTheme);
  updateFaviconAndBrand(currentTheme);
}

function initLanguage() {
  const curLang = i18n.getLang();
  document.documentElement.setAttribute('lang', curLang);
  updateLanguageButtons(curLang);
  applyLanguageTranslations();
}

function updateLanguageButtons(lang) {
  document.getElementById('langKoBtn')?.classList.toggle('active', lang === 'ko');
  document.getElementById('langEnBtn')?.classList.toggle('active', lang === 'en');
}

function setupAutoExpandingTextareas() {
  document.querySelectorAll('.auto-textarea').forEach(el => setupAutoTextarea(el));
}

// --- STATE SYNCHRONIZATION ---
function onStateChange(state) {
  // Update Scope buttons
  document.getElementById('scopeABtn').classList.toggle('active', state.scope === CONFIG.SCOPES.SCOPE_A);
  document.getElementById('scopeBBtn').classList.toggle('active', state.scope === CONFIG.SCOPES.SCOPE_B);

  // Update Active Plan Selector in Filter Bar
  const planSelect = document.getElementById('planSelectFilter');
  if (planSelect) {
    const currentVal = state.selectedPlanId || '';
    planSelect.innerHTML = `<option value="">${i18n.t('allPlans')} (${state.plans.length})</option>` +
      state.plans.map(p => `<option value="${p.id}" ${p.id === currentVal ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('');
  }

  // Render Plan Column with search-filtered plans (including plans with matching child To Dos)
  const filteredPlans = appState.getFilteredPlans();
  renderPlanColumn(filteredPlans, state.selectedPlanId);

  // Render Do Column with search/status/priority/tags filtered To Dos
  const filteredTodos = appState.getFilteredTodos();
  const selectedPlan = state.plans.find(p => p.id === state.selectedPlanId);
  renderDoColumn(filteredTodos, state.do_logs, selectedPlan, state.filters.tags || []);

  // Render See Column
  const metrics = appState.getKSTMetrics();
  renderSeeColumn(metrics, selectedPlan, state.see_reviews);

  // Mobile Tabs Sync
  updateMobileNavState(state.activeMobileTab);
}

function updateThemeButtons(theme) {
  document.querySelectorAll('.theme-color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

function updateMobileNavState(tab) {
  document.querySelectorAll('.kanban-col').forEach(col => {
    col.classList.toggle('mobile-active', col.dataset.col === tab);
  });
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

function startLiveKstClock() {
  const clockEl = document.getElementById('kstLiveClock');
  if (!clockEl) return;
  const update = () => {
    clockEl.textContent = formatKSTLiveClock(new Date(), i18n.getLang());
  };
  update();
  setInterval(update, 1000);
}

// --- HEADER CONTROLS ---
function bindHeaderControls() {
  // Scope Switching (A/B) with Memory Purge
  document.getElementById('scopeABtn').addEventListener('click', async () => {
    if (appState.getState().scope !== CONFIG.SCOPES.SCOPE_A) {
      await appState.switchScope(CONFIG.SCOPES.SCOPE_A);
      showToast(i18n.t('scopeSwitched'), 'info');
    }
  });

  document.getElementById('scopeBBtn').addEventListener('click', async () => {
    if (appState.getState().scope !== CONFIG.SCOPES.SCOPE_B) {
      await appState.switchScope(CONFIG.SCOPES.SCOPE_B);
      showToast(i18n.t('scopeSwitched'), 'info');
    }
  });

  // Language Switching (KST / EDT)
  document.getElementById('langKoBtn')?.addEventListener('click', () => {
    i18n.setLang('ko');
    updateLanguageButtons('ko');
    applyLanguageTranslations();
    onStateChange(appState.getState());
    showToast(i18n.t('langChanged'), 'info');
  });

  document.getElementById('langEnBtn')?.addEventListener('click', () => {
    i18n.setLang('en');
    updateLanguageButtons('en');
    applyLanguageTranslations();
    onStateChange(appState.getState());
    showToast(i18n.t('langChanged'), 'info');
  });

  // Theme Buttons (Color Dots)
  document.querySelectorAll('.theme-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      appState.setTheme(theme);
      updateThemeButtons(theme);
      updateFaviconAndBrand(theme);
      showToast(i18n.t('themeChanged'), 'info');
    });
  });

  // Export JSON Backup
  document.getElementById('exportBtn').addEventListener('click', async () => {
    try {
      const backup = await API.exportBackup();
      const jsonStr = JSON.stringify(backup, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pds-diary-${backup.scope}-${getKSTToday()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showToast(i18n.t('backupExported'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Import JSON Backup Modal
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').value = '';
    modalManager.open('importModal');
  });

  // Reset Scope Data Modal
  document.getElementById('resetScopeBtn').addEventListener('click', () => {
    const scopeLabel = appState.getState().scope === CONFIG.SCOPES.SCOPE_A ? 'Scope A' : 'Scope B';
    const targetLabel = document.getElementById('resetTargetScopeLabel');
    if (targetLabel) targetLabel.textContent = scopeLabel;
    modalManager.open('resetModal');
  });

  // New Plan Header Button
  document.getElementById('headerNewPlanBtn').addEventListener('click', openCreatePlanModal);
}

// --- FILTER CONTROLS ---
function bindFilterControls() {
  document.getElementById('planSelectFilter').addEventListener('change', (e) => {
    appState.setSelectedPlan(e.target.value || null);
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    appState.setFilters({ search: e.target.value });
  });

  document.getElementById('priorityFilter').addEventListener('change', (e) => {
    appState.setFilters({ priority: e.target.value });
  });

  document.getElementById('statusFilter').addEventListener('change', (e) => {
    appState.setFilters({ status: e.target.value });
  });

  document.getElementById('sortSelect').addEventListener('change', (e) => {
    appState.setFilters({ sort: e.target.value });
  });

  // Mobile Bottom Nav Tabs
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.setMobileTab(btn.dataset.tab);
    });
  });
}

// --- BOARD & COLUMN ACTIONS (Click-to-Select on Plan Card & Multi-Tag Filtering) ---
function bindBoardActions() {
  // Plan Column Actions
  document.getElementById('colAddPlanBtn').addEventListener('click', openCreatePlanModal);

  document.getElementById('planColBody').addEventListener('click', async (e) => {
    // Empty state new plan button click
    const emptyBtn = e.target.closest('#emptyStateNewPlanBtn');
    if (emptyBtn) {
      openCreatePlanModal();
      return;
    }

    const planCard = e.target.closest('.plan-card');
    if (!planCard) return;

    const planId = planCard.dataset.planId;
    const actionBtn = e.target.closest('button');

    // If clicking action buttons inside the card
    if (actionBtn) {
      e.stopPropagation();
      if (actionBtn.classList.contains('plan-history-btn')) {
        openPlanHistoryModal(planId);
      } else if (actionBtn.classList.contains('edit-plan-btn')) {
        openEditPlanModal(planId);
      } else if (actionBtn.classList.contains('delete-plan-btn')) {
        if (confirm(i18n.getLang() === 'ko' ? '이 계획과 연결된 모든 할 일을 삭제하시겠습니까?' : 'Delete this plan and all associated To Dos?')) {
          try {
            await API.deletePlan(planId);
            await appState.refreshData();
            showToast(i18n.t('planDeleted'), 'info');
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      }
      return;
    }

    // Direct card click selects the plan
    appState.setSelectedPlan(planId);
  });

  // Do Column Actions & Multi-Tag Filtering
  document.getElementById('colAddTodoBtn').addEventListener('click', openCreateTodoModal);

  document.getElementById('doColBody').addEventListener('click', async (e) => {
    // Empty state new todo button click
    const emptyTodoBtn = e.target.closest('#emptyStateNewTodoBtn');
    if (emptyTodoBtn) {
      openCreateTodoModal();
      return;
    }

    // Clear all tags button
    if (e.target.classList.contains('clear-all-tags-btn')) {
      appState.clearTagFilters();
      return;
    }

    // Remove single tag badge button
    const removeTagBtn = e.target.closest('.remove-single-tag-btn');
    if (removeTagBtn) {
      const tagToRemove = removeTagBtn.dataset.tag;
      appState.toggleTagFilter(tagToRemove);
      return;
    }

    // Tag chip clicked: toggle this tag in multi-filter
    const tagBtn = e.target.closest('.tag-filter-chip');
    if (tagBtn) {
      const clickedTag = tagBtn.dataset.tag;
      appState.toggleTagFilter(clickedTag);
      return;
    }

    const checkbox = e.target.closest('.custom-checkbox');
    if (checkbox) {
      const todoId = checkbox.dataset.todoId;
      if (activeCheckboxToggles.has(todoId)) return;
      activeCheckboxToggles.add(todoId);

      const state = appState.getState();
      const todo = state.todos.find(t => t.id === todoId);
      if (todo) {
        const nextCompleted = !todo.is_completed;
        try {
          await appState.optimisticUpdateTodo(
            todoId,
            { is_completed: nextCompleted, completed_at: nextCompleted ? new Date().toISOString() : null },
            () => API.updateTodo(todoId, {
              is_completed: nextCompleted,
              completed_at: nextCompleted ? new Date().toISOString() : null
            })
          );
          showToast(nextCompleted ? i18n.t('todoCompleted') : i18n.t('todoInProgress'), 'success');
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          setTimeout(() => activeCheckboxToggles.delete(todoId), 400);
        }
      } else {
        activeCheckboxToggles.delete(todoId);
      }
      return;
    }

    const btn = e.target.closest('button');
    if (!btn) return;

    const todoCard = btn.closest('.todo-card');
    const todoId = todoCard?.dataset.todoId;
    if (!todoId) return;

    if (btn.classList.contains('log-exec-btn')) {
      openExecLoggerModal(todoId);
    } else if (btn.classList.contains('edit-todo-btn')) {
      openEditTodoModal(todoId);
    } else if (btn.classList.contains('delete-todo-btn')) {
      if (confirm(i18n.getLang() === 'ko' ? '이 할 일을 삭제하시겠습니까?' : 'Delete this To Do?')) {
        try {
          await API.deleteTodo(todoId);
          await appState.refreshData();
          showToast(i18n.t('todoDeleted'), 'info');
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    }
  });

  // See Column Actions
  document.getElementById('colReflectBtn').addEventListener('click', openSeeReviewModal);

  document.getElementById('seeColBody').addEventListener('click', (e) => {
    if (e.target.id === 'advanceFeedbackLoopBtn' || e.target.closest('#advanceFeedbackLoopBtn')) {
      advanceFeedbackLoopToNextPlan();
    }
  });
}

// --- PRIORITY PILL BUTTONS ---
function bindPriorityPills() {
  document.querySelectorAll('#planPriorityPills .priority-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#planPriorityPills .priority-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('planPriorityInput').value = btn.dataset.priority;
    });
  });

  document.querySelectorAll('#todoPriorityPills .priority-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#todoPriorityPills .priority-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('todoPriorityInput').value = btn.dataset.priority;
    });
  });
}

function setPriorityPill(containerId, hiddenInputId, priority) {
  const p = priority || 'medium';
  document.getElementById(hiddenInputId).value = p;
  document.querySelectorAll(`#${containerId} .priority-pill-btn`).forEach(b => {
    b.classList.toggle('active', b.dataset.priority === p);
  });
}

// --- INPUT VALIDATIONS (Numbers only & Date ranges) ---
function bindInputValidations() {
  // Plan Minutes validation
  const hoursInput = document.getElementById('planHoursInput');
  if (hoursInput) {
    hoursInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val && !/^\d*$/.test(val)) {
        showToast(i18n.t('onlyNumbersAllowed'), 'warning');
        e.target.value = val.replace(/[^0-9]/g, '');
      }
    });
  }

  // To Do Minutes validation
  const minInput = document.getElementById('todoEstimatedMinutesInput');
  if (minInput) {
    minInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val && !/^\d*$/.test(val)) {
        showToast(i18n.t('onlyNumbersAllowed'), 'warning');
        e.target.value = val.replace(/[^0-9]/g, '');
      }
    });
  }

  // Exec Minutes validation
  const execMinInput = document.getElementById('execMinutesInput');
  if (execMinInput) {
    execMinInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val && !/^\d*$/.test(val)) {
        showToast(i18n.t('onlyNumbersAllowed'), 'warning');
        e.target.value = val.replace(/[^0-9]/g, '');
      }
    });
  }

  // Plan Start/End Date validation
  const planStart = document.getElementById('planStartInput');
  const planEnd = document.getElementById('planEndInput');
  const checkPlanDates = () => {
    if (planStart.value && planEnd.value && planEnd.value < planStart.value) {
      showToast(i18n.t('dateRangeError'), 'warning');
      planEnd.classList.add('input-invalid');
    } else {
      planEnd.classList.remove('input-invalid');
    }
  };
  planStart?.addEventListener('change', checkPlanDates);
  planEnd?.addEventListener('change', checkPlanDates);

  // Exec Start/End DateTime validation
  const execStart = document.getElementById('execStartInput');
  const execEnd = document.getElementById('execEndInput');
  const checkExecTimes = () => {
    if (execStart.value && execEnd.value) {
      const s = new Date(execStart.value).getTime();
      const en = new Date(execEnd.value).getTime();
      if (en < s) {
        showToast(i18n.t('timeRangeError'), 'warning');
        execEnd.classList.add('input-invalid');
      } else {
        execEnd.classList.remove('input-invalid');
        const diffMins = Math.max(1, Math.round((en - s) / 60000));
        document.getElementById('execMinutesInput').value = diffMins;
      }
    }
  };
  execStart?.addEventListener('change', checkExecTimes);
  execEnd?.addEventListener('change', checkExecTimes);
}

// --- MODALS & FORMS ---
function bindModalForms() {
  // Plan Modal
  let isSubmittingPlan = false;
  document.getElementById('planModalCloseBtn').addEventListener('click', () => modalManager.attemptClose('planModal'));
  document.getElementById('planModalCancelBtn').addEventListener('click', () => modalManager.attemptClose('planModal'));
  document.getElementById('planForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingPlan) return;
    isSubmittingPlan = true;

    const submitBtn = document.getElementById('planFormSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.pointerEvents = 'none';
    }

    const unlock = () => {
      setTimeout(() => {
        isSubmittingPlan = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.style.pointerEvents = '';
        }
      }, 600);
    };

    const id = document.getElementById('planFormId').value;
    const isEdit = Boolean(id);

    const startVal = document.getElementById('planStartInput').value;
    const endVal = document.getElementById('planEndInput').value;

    if (endVal < startVal) {
      showToast(i18n.t('dateRangeError'), 'error');
      unlock();
      return;
    }

    const estimatedMinutes = parseInt(document.getElementById('planHoursInput').value, 10) || 0;
    if (estimatedMinutes <= 0) {
      showToast(i18n.t('minDurationRequired'), 'error');
      document.getElementById('planHoursInput').focus();
      unlock();
      return;
    }

    if (isEdit) {
      const childTodos = appState.getState().todos.filter(t => String(t.plan_id) === String(id));
      const totalTodoMinutes = childTodos.reduce((sum, t) => sum + (parseInt(t.estimated_minutes, 10) || 0), 0);
      if (totalTodoMinutes > 0 && estimatedMinutes < totalTodoMinutes) {
        const msg = i18n.t('planHoursLessThanTodos')
          .replace('{hours}', estimatedMinutes)
          .replace('{todoMinutes}', totalTodoMinutes);
        showToast(msg, 'error', 6000);
        unlock();
        return;
      }
    }

    const payload = {
      title: document.getElementById('planTitleInput').value.trim(),
      period_start: startVal,
      period_end: endVal,
      priority: document.getElementById('planPriorityInput').value,
      estimated_hours: estimatedMinutes,
      success_criteria: document.getElementById('planCriteriaInput').value.trim(),
      status: 'active'
    };

    if (isEdit) {
      const revisionReason = document.getElementById('planRevisionReasonInput').value.trim();
      const existingPlan = appState.getState().plans.find(p => p.id === id);

      // Verify that actual plan data changed
      const isContentChanged = existingPlan && (
        existingPlan.title !== payload.title ||
        existingPlan.period_start !== payload.period_start ||
        existingPlan.period_end !== payload.period_end ||
        existingPlan.priority !== payload.priority ||
        existingPlan.estimated_hours !== payload.estimated_hours ||
        existingPlan.success_criteria !== payload.success_criteria
      );

      if (!isContentChanged) {
        showToast(i18n.t('noChangesMade'), 'warning');
        modalManager.forceClose('planModal');
        unlock();
        return;
      }

      payload.revision_reason = revisionReason || (i18n.getLang() === 'ko' ? '계획 정보 수정' : 'Plan updated');
    }

    try {
      if (isEdit) {
        await API.updatePlan(id, payload);
        modalManager.forceClose('planModal');
        await appState.refreshData();
        showToast(i18n.t('planUpdated'), 'success');
      } else {
        const createdPlan = await API.createPlan(payload);
        modalManager.forceClose('planModal');
        // Clear search query so new plan is immediately visible
        appState.setFilters({ search: '' });
        await appState.refreshData();
        appState.setSelectedPlan(createdPlan.id);
        showToast(i18n.t('planSaved'), 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      unlock();
    }
  });

  // To Do Modal
  document.getElementById('todoModalCloseBtn').addEventListener('click', () => modalManager.attemptClose('todoModal'));
  document.getElementById('todoModalCancelBtn').addEventListener('click', () => modalManager.attemptClose('todoModal'));

  document.getElementById('todoPlanSelect').addEventListener('change', (e) => {
    const selectedPlan = appState.getState().plans.find(p => p.id === e.target.value);
    if (selectedPlan && selectedPlan.period_end) {
      document.getElementById('todoDueDateInput').max = selectedPlan.period_end;
      if (document.getElementById('todoDueDateInput').value > selectedPlan.period_end) {
        document.getElementById('todoDueDateInput').value = selectedPlan.period_end;
        const msg = i18n.t('todoDueDateExceedsPlan').replace('{date}', selectedPlan.period_end);
        showToast(msg, 'warning', 4500);
      }
    }
  });

  document.getElementById('todoEstimatedMinutesInput').addEventListener('input', (e) => {
    const planId = document.getElementById('todoPlanSelect').value;
    const selectedPlan = appState.getState().plans.find(p => String(p.id) === String(planId));
    const id = document.getElementById('todoFormId').value;
    const isEdit = Boolean(id);
    const estimatedMinutes = parseInt(e.target.value, 10) || 0;

    if (selectedPlan) {
      const planBudgetMinutes = parseInt(selectedPlan.estimated_hours, 10) || 0;
      if (planBudgetMinutes > 0) {
        const otherTodos = appState.getState().todos.filter(t => String(t.plan_id) === String(planId) && (!isEdit || String(t.id) !== String(id)));
        const currentTotalMinutes = otherTodos.reduce((sum, t) => sum + (parseInt(t.estimated_minutes, 10) || 0), 0);
        const newTotalMinutes = currentTotalMinutes + estimatedMinutes;
        if (newTotalMinutes > planBudgetMinutes) {
          e.target.classList.add('input-invalid');
        } else {
          e.target.classList.remove('input-invalid');
        }
      }
    }
  });

  let isSubmittingTodo = false;
  document.getElementById('todoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingTodo) return;
    isSubmittingTodo = true;

    const submitBtn = document.getElementById('todoFormSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.pointerEvents = 'none';
    }

    const unlock = () => {
      setTimeout(() => {
        isSubmittingTodo = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.style.pointerEvents = '';
        }
      }, 600);
    };

    const id = document.getElementById('todoFormId').value;
    const isEdit = Boolean(id);

    const planId = document.getElementById('todoPlanSelect').value;
    const dueDate = document.getElementById('todoDueDateInput').value;
    const selectedPlan = appState.getState().plans.find(p => String(p.id) === String(planId));

    // Guard 1: Prevent To Do due date from exceeding linked plan's end date
    if (selectedPlan && selectedPlan.period_end && dueDate > selectedPlan.period_end) {
      const msg = i18n.t('todoDueDateExceedsPlan').replace('{date}', selectedPlan.period_end);
      showToast(msg, 'error', 5000);
      unlock();
      return;
    }

    const estimatedMinutes = parseInt(document.getElementById('todoEstimatedMinutesInput').value, 10) || 0;
    if (estimatedMinutes <= 0) {
      showToast(i18n.t('minDurationRequired'), 'error');
      document.getElementById('todoEstimatedMinutesInput').focus();
      unlock();
      return;
    }

    // Guard 2: Prevent child To Dos sum from exceeding Plan total estimated budget
    if (selectedPlan) {
      const planBudgetMinutes = parseInt(selectedPlan.estimated_hours, 10) || 0;
      if (planBudgetMinutes > 0 && estimatedMinutes > 0) {
        const otherTodos = appState.getState().todos.filter(t => String(t.plan_id) === String(planId) && (!isEdit || String(t.id) !== String(id)));
        const currentTotalMinutes = otherTodos.reduce((sum, t) => sum + (parseInt(t.estimated_minutes, 10) || 0), 0);
        const newTotalMinutes = currentTotalMinutes + estimatedMinutes;
        if (newTotalMinutes > planBudgetMinutes) {
          const msg = i18n.t('todosExceedPlanHours')
            .replace('{totalMinutes}', newTotalMinutes)
            .replace('{planHours}', planBudgetMinutes);
          showToast(msg, 'error', 5500);
          unlock();
          return;
        }
      }
    }

    const tagsRaw = document.getElementById('todoTagsInput').value;
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

    const payload = {
      plan_id: planId,
      title: document.getElementById('todoTitleInput').value.trim(),
      due_date: dueDate,
      priority: document.getElementById('todoPriorityInput').value,
      estimated_minutes: estimatedMinutes,
      tags: tags,
      description: document.getElementById('todoDescInput').value.trim()
    };

    try {
      if (isEdit) {
        await API.updateTodo(id, payload);
        showToast(i18n.t('todoUpdated'), 'success');
      } else {
        await API.createTodo(payload);
        showToast(i18n.t('todoAdded'), 'success');
      }
      modalManager.forceClose('todoModal');
      await appState.refreshData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      unlock();
    }
  });

  // Do Execution Logger & Timer Controls
  document.getElementById('execModalCloseBtn').addEventListener('click', () => {
    stopTimer();
    modalManager.attemptClose('execModal');
  });
  document.getElementById('execModalCancelBtn').addEventListener('click', () => {
    stopTimer();
    modalManager.attemptClose('execModal');
  });

  const recalcExecDuration = () => {
    const startVal = document.getElementById('execStartInput').value;
    const endVal = document.getElementById('execEndInput').value;
    if (startVal && endVal) {
      const diffMs = new Date(endVal).getTime() - new Date(startVal).getTime();
      if (diffMs >= 0) {
        const mins = Math.round(diffMs / 60000);
        document.getElementById('execMinutesInput').value = mins;
      }
    }
  };

  document.getElementById('execStartInput').addEventListener('change', recalcExecDuration);
  document.getElementById('execEndInput').addEventListener('change', recalcExecDuration);

  document.getElementById('execTimerStartBtn').addEventListener('click', startTimer);
  document.getElementById('execTimerStopBtn').addEventListener('click', stopTimer);
  document.getElementById('execTimerResetBtn').addEventListener('click', resetTimer);

  // Complete & Log (Idempotent submission with token locking)
  let isSubmittingExec = false;
  document.getElementById('execForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingExec) return;
    isSubmittingExec = true;

    const submitBtn = document.getElementById('execCompleteAndLogBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.pointerEvents = 'none';
    }

    const unlock = () => {
      setTimeout(() => {
        isSubmittingExec = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.style.pointerEvents = '';
        }
      }, 600);
    };

    const todoId = document.getElementById('execTodoId').value;
    const startVal = document.getElementById('execStartInput').value;
    const endVal = document.getElementById('execEndInput').value;

    if (startVal && endVal && new Date(endVal).getTime() < new Date(startVal).getTime()) {
      showToast(i18n.t('timeRangeError'), 'error');
      unlock();
      return;
    }
    
    const actualMin = parseInt(document.getElementById('execMinutesInput').value, 10) || 0;
    if (actualMin <= 0) {
      showToast(i18n.t('minDurationRequired'), 'error');
      document.getElementById('execMinutesInput').focus();
      unlock();
      return;
    }

    const completionToken = crypto.randomUUID();
    const startTime = startVal ? new Date(startVal).toISOString() : new Date().toISOString();
    const endTime = endVal ? new Date(endVal).toISOString() : new Date().toISOString();
    const blockedReason = document.getElementById('execBlockerInput').value.trim();

    try {
      const result = await API.completeTodoIdempotent(todoId, {
        execution_start: startTime,
        execution_end: endTime,
        actual_minutes: actualMin,
        blocked_reason: blockedReason
      }, completionToken);

      stopTimer();
      modalManager.forceClose('execModal');
      await appState.refreshData();
      showToast(result.isDuplicate ? 'Action already recorded.' : i18n.t('todoCompleted'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      unlock();
    }
  });

  // Save Log Only (without completing To Do)
  let isSubmittingLogOnly = false;
  document.getElementById('execSaveLogOnlyBtn').addEventListener('click', async () => {
    if (isSubmittingLogOnly) return;
    isSubmittingLogOnly = true;

    const saveBtn = document.getElementById('execSaveLogOnlyBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.style.pointerEvents = 'none';
    }

    const unlock = () => {
      setTimeout(() => {
        isSubmittingLogOnly = false;
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.style.pointerEvents = '';
        }
      }, 600);
    };

    const todoId = document.getElementById('execTodoId').value;
    const startVal = document.getElementById('execStartInput').value;
    const endVal = document.getElementById('execEndInput').value;

    if (startVal && endVal && new Date(endVal).getTime() < new Date(startVal).getTime()) {
      showToast(i18n.t('timeRangeError'), 'error');
      unlock();
      return;
    }

    const actualMin = parseInt(document.getElementById('execMinutesInput').value, 10) || 0;
    if (actualMin <= 0) {
      showToast(i18n.t('minDurationRequired'), 'error');
      document.getElementById('execMinutesInput').focus();
      unlock();
      return;
    }

    const startTime = startVal ? new Date(startVal).toISOString() : new Date().toISOString();
    const endTime = endVal ? new Date(endVal).toISOString() : new Date().toISOString();
    const blockedReason = document.getElementById('execBlockerInput').value.trim();

    try {
      await API.addDoLog(todoId, {
        execution_start: startTime,
        execution_end: endTime,
        actual_minutes: actualMin,
        blocked_reason: blockedReason
      });
      stopTimer();
      modalManager.forceClose('execModal');
      await appState.refreshData();
      showToast(i18n.getLang() === 'ko' ? '실행 기록이 저장되었습니다.' : 'Execution log saved.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      unlock();
    }
  });

  // Revision History Modal Close
  document.getElementById('historyModalCloseBtn').addEventListener('click', () => modalManager.forceClose('historyModal'));
  document.getElementById('historyModalDismissBtn').addEventListener('click', () => modalManager.forceClose('historyModal'));

  // See Review Modal
  let isSubmittingSee = false;
  document.getElementById('seeModalCloseBtn').addEventListener('click', () => modalManager.attemptClose('seeModal'));
  document.getElementById('seeModalCancelBtn').addEventListener('click', () => modalManager.attemptClose('seeModal'));
  document.getElementById('seeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingSee) return;
    isSubmittingSee = true;

    const submitBtn = document.getElementById('seeFormSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.pointerEvents = 'none';
    }

    const unlock = () => {
      setTimeout(() => {
        isSubmittingSee = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.style.pointerEvents = '';
        }
      }, 600);
    };

    const planId = appState.getState().selectedPlanId;
    if (!planId) {
      showToast(i18n.t('selectPlanFirst'), 'warning');
      unlock();
      return;
    }

    const metrics = appState.getKSTMetrics(planId);
    const reviewDate = document.getElementById('seeReviewDateInput').value;
    const insight = document.getElementById('seeInsightInput').value.trim();

    try {
      await API.createSeeReview({
        plan_id: planId,
        review_date: reviewDate,
        planned_count: metrics.plannedCount,
        completed_count: metrics.completedCount,
        delayed_count: metrics.delayedCount,
        blocked_count: metrics.blockedCount,
        time_delta_minutes: metrics.timeDeltaMinutes,
        adjustment_insight: insight,
        feedback_applied: false
      });
      modalManager.forceClose('seeModal');
      await appState.refreshData();
      showToast(i18n.getLang() === 'ko' ? '회고가 저장되었습니다.' : 'Reflection saved successfully.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      unlock();
    }
  });

  // Reset Confirmation Modal
  let isSubmittingReset = false;
  document.getElementById('resetModalCloseBtn').addEventListener('click', () => modalManager.forceClose('resetModal'));
  document.getElementById('resetModalCancelBtn').addEventListener('click', () => modalManager.forceClose('resetModal'));
  document.getElementById('resetModalConfirmBtn').addEventListener('click', async () => {
    if (isSubmittingReset) return;
    isSubmittingReset = true;

    const confirmBtn = document.getElementById('resetModalConfirmBtn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.style.pointerEvents = 'none';
    }

    const unlock = () => {
      setTimeout(() => {
        isSubmittingReset = false;
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.style.pointerEvents = '';
        }
      }, 600);
    };

    try {
      await API.purgeCurrentScope();
      modalManager.forceClose('resetModal');
      await appState.init();
      showToast(i18n.t('resetSuccess'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      unlock();
    }
  });

  // Import JSON Modal
  let isSubmittingImport = false;
  document.getElementById('importModalCloseBtn').addEventListener('click', () => modalManager.forceClose('importModal'));
  document.getElementById('importModalCancelBtn').addEventListener('click', () => modalManager.forceClose('importModal'));
  document.getElementById('importModalSubmitBtn').addEventListener('click', async () => {
    if (isSubmittingImport) return;
    isSubmittingImport = true;

    const submitBtn = document.getElementById('importModalSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.pointerEvents = 'none';
    }

    const unlock = () => {
      setTimeout(() => {
        isSubmittingImport = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.style.pointerEvents = '';
        }
      }, 600);
    };

    const fileInput = document.getElementById('importFileInput');
    if (!fileInput.files || fileInput.files.length === 0) {
      showToast(i18n.getLang() === 'ko' ? '가져올 JSON 파일을 선택하세요.' : 'Please select a JSON file to import.', 'warning');
      unlock();
      return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        await API.importBackup(text, file.size);
        modalManager.forceClose('importModal');
        await appState.refreshData();
        showToast(i18n.t('backupImported'), 'success');
      } catch (err) {
        showToast(`Import Error: ${err.message}`, 'error', 6000);
      } finally {
        unlock();
      }
    };

    reader.onerror = () => {
      showToast('Failed to read file from disk.', 'error');
      unlock();
    };

    reader.readAsText(file);
  });
}

// --- MODAL OPENERS ---
function openCreatePlanModal() {
  document.getElementById('planModalTitle').textContent = i18n.t('createPlanTitle');
  document.getElementById('planFormId').value = '';
  document.getElementById('planTitleInput').value = '';
  document.getElementById('planStartInput').value = getKSTToday();
  document.getElementById('planEndInput').value = getKSTToday();
  setPriorityPill('planPriorityPills', 'planPriorityInput', 'medium');
  document.getElementById('planHoursInput').value = '60';
  document.getElementById('planCriteriaInput').value = '';
  document.getElementById('planRevisionReasonGroup').style.display = 'none';
  document.getElementById('planRevisionReasonInput').value = '';
  modalManager.open('planModal');
}

function openEditPlanModal(planId) {
  const plan = appState.getState().plans.find(p => p.id === planId);
  if (!plan) return;

  document.getElementById('planModalTitle').textContent = i18n.t('editPlanTitle');
  document.getElementById('planFormId').value = plan.id;
  document.getElementById('planTitleInput').value = plan.title;
  document.getElementById('planStartInput').value = plan.period_start;
  document.getElementById('planEndInput').value = plan.period_end;
  setPriorityPill('planPriorityPills', 'planPriorityInput', plan.priority || 'medium');
  document.getElementById('planHoursInput').value = plan.estimated_hours;
  document.getElementById('planCriteriaInput').value = plan.success_criteria || '';
  document.getElementById('planRevisionReasonGroup').style.display = 'block';
  document.getElementById('planRevisionReasonInput').value = '';
  modalManager.open('planModal');
}

function openPlanHistoryModal(planId) {
  const state = appState.getState();
  const plan = state.plans.find(p => p.id === planId);
  const histories = state.plan_histories.filter(h => h.plan_id === planId);
  renderPlanHistoryModal(plan, histories);
  modalManager.open('historyModal');
}

function openCreateTodoModal() {
  const state = appState.getState();
  if (state.plans.length === 0) {
    showToast(i18n.t('selectPlanFirst'), 'warning');
    openCreatePlanModal();
    return;
  }

  const select = document.getElementById('todoPlanSelect');
  select.innerHTML = state.plans.map(p => `
    <option value="${p.id}" ${p.id === state.selectedPlanId ? 'selected' : ''}>${escapeHtml(p.title)}</option>
  `).join('');

  const targetPlan = state.plans.find(p => p.id === state.selectedPlanId) || state.plans[0];
  const dueDateInput = document.getElementById('todoDueDateInput');
  const today = getKSTToday();

  if (targetPlan && targetPlan.period_end) {
    dueDateInput.max = targetPlan.period_end;
    dueDateInput.value = today > targetPlan.period_end ? targetPlan.period_end : today;
  } else {
    dueDateInput.removeAttribute('max');
    dueDateInput.value = today;
  }

  document.getElementById('todoModalTitle').textContent = i18n.t('addTodoTitle');
  document.getElementById('todoFormId').value = '';
  document.getElementById('todoTitleInput').value = '';
  setPriorityPill('todoPriorityPills', 'todoPriorityInput', 'medium');
  document.getElementById('todoEstimatedMinutesInput').value = '';
  document.getElementById('todoTagsInput').value = '';
  document.getElementById('todoDescInput').value = '';
  modalManager.open('todoModal');
}

function openEditTodoModal(todoId) {
  const state = appState.getState();
  const todo = state.todos.find(t => t.id === todoId);
  if (!todo) return;

  const select = document.getElementById('todoPlanSelect');
  select.innerHTML = state.plans.map(p => `
    <option value="${p.id}" ${p.id === todo.plan_id ? 'selected' : ''}>${escapeHtml(p.title)}</option>
  `).join('');

  const targetPlan = state.plans.find(p => p.id === todo.plan_id);
  const dueDateInput = document.getElementById('todoDueDateInput');
  if (targetPlan && targetPlan.period_end) {
    dueDateInput.max = targetPlan.period_end;
  } else {
    dueDateInput.removeAttribute('max');
  }

  document.getElementById('todoModalTitle').textContent = i18n.t('editTodoTitle');
  document.getElementById('todoFormId').value = todo.id;
  document.getElementById('todoTitleInput').value = todo.title;
  dueDateInput.value = todo.due_date;
  setPriorityPill('todoPriorityPills', 'todoPriorityInput', todo.priority || 'medium');
  document.getElementById('todoEstimatedMinutesInput').value = todo.estimated_minutes;
  document.getElementById('todoTagsInput').value = (todo.tags || []).join(', ');
  document.getElementById('todoDescInput').value = todo.description || '';
  modalManager.open('todoModal');
}

function openExecLoggerModal(todoId) {
  const todo = appState.getState().todos.find(t => t.id === todoId);
  if (!todo) return;

  document.getElementById('execTodoId').value = todo.id;
  document.getElementById('execTodoSummary').textContent = `${todo.title} (${i18n.t('estimatedLabel')} ${todo.estimated_minutes || 0}${i18n.t('minutesUnit')})`;
  
  const now = new Date();
  const toLocalInput = (d) => {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const estMinutes = Number(todo.estimated_minutes) || 30;
  const startTime = new Date(now.getTime() - (estMinutes * 60000));

  document.getElementById('execStartInput').value = toLocalInput(startTime);
  document.getElementById('execEndInput').value = toLocalInput(now);
  document.getElementById('execMinutesInput').value = estMinutes;
  document.getElementById('execBlockerInput').value = '';

  resetTimer();
  modalManager.open('execModal');
}

function openSeeReviewModal() {
  const planId = appState.getState().selectedPlanId;
  if (!planId) {
    showToast(i18n.t('selectPlanFirst'), 'warning');
    return;
  }
  document.getElementById('seeReviewDateInput').value = getKSTToday();
  document.getElementById('seeInsightInput').value = '';
  modalManager.open('seeModal');
}

// --- 1-CLICK FEEDBACK LOOP ---
function advanceFeedbackLoopToNextPlan() {
  const state = appState.getState();
  const currentPlan = state.plans.find(p => p.id === state.selectedPlanId);
  const metrics = appState.getKSTMetrics();

  document.getElementById('planModalTitle').textContent = i18n.getLang() === 'ko' ? '다음 계획에 개선 사항 반영하기' : 'Advance Feedback into Next Plan';
  document.getElementById('planFormId').value = '';
  
  // Title with [RE] prefix
  const originalTitle = currentPlan ? currentPlan.title : 'New Plan';
  document.getElementById('planTitleInput').value = originalTitle.startsWith('[RE]') ? originalTitle : `[RE] ${originalTitle}`;
  
  document.getElementById('planStartInput').value = getKSTToday();
  document.getElementById('planEndInput').value = getKSTToday();
  setPriorityPill('planPriorityPills', 'planPriorityInput', currentPlan ? currentPlan.priority : 'high');
  
  const adjustedMin = metrics.totalActualMin || 60;
  document.getElementById('planHoursInput').value = adjustedMin;

  const autoInsight = `${i18n.getLang() === 'ko' ? '이전 주기 피드백 기반 자동 조정' : 'Adjusted based on previous cycle'} (${i18n.t('metricPlanned')}: ${metrics.plannedCount}, ${i18n.t('metricCompleted')}: ${metrics.completedCount}, ${i18n.t('metricDelayed')}: ${metrics.delayedCount}, ${i18n.t('metricTimeDelta')}: ${metrics.timeDeltaMinutes}${i18n.t('minutesUnit')})`;
  document.getElementById('planCriteriaInput').value = autoInsight;
  document.getElementById('planRevisionReasonGroup').style.display = 'none';

  modalManager.open('planModal');
  showToast(i18n.getLang() === 'ko' ? '이전 주기 개선점이 새 계획에 반영되었습니다.' : 'Feedback insights populated into next plan draft.', 'info');
}

// --- BACKGROUND DRIFT-CORRECTED TIMER ---
function startTimer() {
  if (timerState.isRunning) return;
  timerState.isRunning = true;
  timerState.startEpoch = Date.now() - (timerState.elapsedSeconds * 1000);
  
  document.getElementById('execTimerStartBtn').disabled = true;
  document.getElementById('execTimerStopBtn').disabled = false;

  timerState.intervalId = setInterval(() => {
    const deltaMs = Date.now() - timerState.startEpoch;
    timerState.elapsedSeconds = Math.floor(deltaMs / 1000);
    updateTimerDisplay();
  }, 500);
}

function stopTimer() {
  if (!timerState.isRunning) return;
  timerState.isRunning = false;
  clearInterval(timerState.intervalId);
  document.getElementById('execTimerStartBtn').disabled = false;
  document.getElementById('execTimerStopBtn').disabled = true;

  const mins = Math.max(1, Math.round(timerState.elapsedSeconds / 60));
  document.getElementById('execMinutesInput').value = mins;
}

function resetTimer() {
  stopTimer();
  timerState.elapsedSeconds = 0;
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const display = document.getElementById('execLiveTimerDisplay');
  if (!display) return;

  const secs = timerState.elapsedSeconds;
  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  display.textContent = `${h}:${m}:${s}`;
}

// --- KEYBOARD SHORTCUTS ---
function bindKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    // Ctrl / Cmd + Enter to submit active modal
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (modalManager.activeModal) {
        const submitBtn = modalManager.activeModal.querySelector('button[type="submit"]');
        if (submitBtn) {
          e.preventDefault();
          submitBtn.click();
        }
      }
      return;
    }

    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    // 'N' for New Plan
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openCreatePlanModal();
      return;
    }

    // '1' / '2' / '3' for Mobile column switching
    if (e.key === '1') {
      appState.setMobileTab('plan');
    } else if (e.key === '2') {
      appState.setMobileTab('do');
    } else if (e.key === '3') {
      appState.setMobileTab('see');
    }
  });
}

// --- MOBILE TOUCH SWIPE GESTURES ---
function bindMobileTouchGestures() {
  const board = document.getElementById('mainBoard');
  if (!board) return;

  let touchStartX = 0;
  let touchStartY = 0;

  board.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  board.addEventListener('touchend', (e) => {
    const deltaX = e.changedTouches[0].screenX - touchStartX;
    const deltaY = e.changedTouches[0].screenY - touchStartY;

    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      const currentTab = appState.getState().activeMobileTab;
      const tabs = ['plan', 'do', 'see'];
      const currentIndex = tabs.indexOf(currentTab);

      if (deltaX < 0 && currentIndex < tabs.length - 1) {
        appState.setMobileTab(tabs[currentIndex + 1]);
      } else if (deltaX > 0 && currentIndex > 0) {
        appState.setMobileTab(tabs[currentIndex - 1]);
      }
    }
  }, { passive: true });
}
