/**
 * Plan-Do-See Diary - UI Rendering, XSS Sanitization & Interaction Layer
 */

import { CONFIG } from './config.js';
import { formatLocalizedDateTime, getKSTToday, isDelayedKST } from './dateUtils.js';
import { i18n } from './i18n.js';

/**
 * Full XSS defense - escapes HTML entities for literal text rendering
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Toast Notification System
 */
export function showToast(message, type = 'info', duration = CONFIG.TOAST_DURATION_MS) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const iconMap = {
    success: '✓',
    error: '✕',
    warning: '!',
    info: 'i'
  };

  toast.innerHTML = `
    <span style="font-weight: 800; font-size: 0.95rem; line-height: 1; min-width: 16px;">${iconMap[type] || 'i'}</span>
    <div style="flex: 1; word-break: break-word;">${escapeHtml(message)}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px) scale(0.96)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/**
 * Dynamic Favicon Updater based on active theme
 */
export function updateFaviconAndBrand(theme) {
  if (typeof document === 'undefined') return;
  const favicon = document.getElementById('dynamicFavicon');
  const brandIcon = document.getElementById('appBrandIcon');
  
  let primaryColor = '#e07a99'; // Bright pastel rose default
  if (theme === 'forest-green') {
    primaryColor = '#1b4d3e';
  } else if (theme === 'modern-black') {
    primaryColor = '#121212';
  }

  if (favicon) {
    const encodedColor = encodeURIComponent(primaryColor);
    favicon.href = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='${encodedColor}'/%3E%3Cpath d='M8 10h16M8 16h16M8 22h10' stroke='%23ffffff' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E`;
  }

  if (brandIcon) {
    brandIcon.style.backgroundColor = primaryColor === '#121212' ? '#38bdf8' : primaryColor;
  }
}

/**
 * Modal Manager with Snapshot-based True Dirty Form Guard
 */
export class ModalManager {
  constructor() {
    this.activeModal = null;
    this.initialSnapshot = null;
    this._initGlobalListeners();
  }

  _captureSnapshot(modal) {
    if (!modal) return {};
    const inputs = modal.querySelectorAll('input:not([type="hidden"]), select, textarea');
    const snapshot = {};
    inputs.forEach((inp, idx) => {
      const key = inp.id || `idx_${idx}`;
      snapshot[key] = (inp.value || '').trim();
    });
    return snapshot;
  }

  isFormActuallyDirty() {
    if (!this.activeModal || !this.initialSnapshot) return false;
    const current = this._captureSnapshot(this.activeModal);
    for (const key of Object.keys(this.initialSnapshot)) {
      const origVal = this.initialSnapshot[key] || '';
      const curVal = current[key] || '';
      if (origVal !== curVal) {
        return true;
      }
    }
    return false;
  }

  _initGlobalListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeModal) {
        this.attemptClose(this.activeModal.id);
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (this.isFormActuallyDirty()) {
        e.preventDefault();
        e.returnValue = i18n.t('dirtyModalBody');
        return e.returnValue;
      }
    });
  }

  open(modalId) {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    this.activeModal = modal;
    modal.classList.add('active');
    
    // Save initial snapshot after rendering values and trigger textarea auto-fit
    setTimeout(() => {
      this.initialSnapshot = this._captureSnapshot(modal);
      triggerTextareaResize(modal);
      const focusable = modal.querySelectorAll('input:not([type="hidden"]), select, textarea, button:not([disabled])');
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }, 20);

    this._trapFocus(modal);
  }

  attemptClose(modalId, force = false) {
    if (!force && this.isFormActuallyDirty()) {
      this.showDirtyConfirm(() => {
        this.forceClose(modalId);
      });
      return;
    }
    this.forceClose(modalId);
  }

  forceClose(modalId) {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
    this.activeModal = null;
    this.initialSnapshot = null;
  }

  showDirtyConfirm(onDiscard) {
    if (typeof document === 'undefined') return;
    const confirmModal = document.getElementById('dirtyConfirmModal');
    if (!confirmModal) {
      if (confirm(i18n.t('dirtyModalBody'))) {
        onDiscard();
      }
      return;
    }
    confirmModal.classList.add('active');

    const discardBtn = document.getElementById('dirtyConfirmDiscardBtn');
    const keepBtn = document.getElementById('dirtyConfirmKeepBtn');

    const handleDiscard = () => {
      confirmModal.classList.remove('active');
      discardBtn.removeEventListener('click', handleDiscard);
      keepBtn.removeEventListener('click', handleKeep);
      onDiscard();
    };

    const handleKeep = () => {
      confirmModal.classList.remove('active');
      discardBtn.removeEventListener('click', handleDiscard);
      keepBtn.removeEventListener('click', handleKeep);
    };

    discardBtn.addEventListener('click', handleDiscard);
    keepBtn.addEventListener('click', handleKeep);
  }

  _trapFocus(element) {
    const focusables = element.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    element.onkeydown = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          last.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
  }
}

export const modalManager = new ModalManager();

/**
 * Setup Auto-expanding & Auto-shrinking Textareas
 */
export function setupAutoTextarea(textarea) {
  if (!textarea) return;
  const resize = () => {
    textarea.style.height = '0px';
    const targetHeight = Math.min(Math.max(textarea.scrollHeight, 68), 240);
    textarea.style.height = `${targetHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 240 ? 'auto' : 'hidden';
  };
  textarea.addEventListener('input', resize);
  textarea.addEventListener('change', resize);
  textarea._autoResize = resize;
  setTimeout(resize, 0);
}

export function triggerTextareaResize(modalOrContainer) {
  if (typeof document === 'undefined') return;
  const container = typeof modalOrContainer === 'string' ? document.getElementById(modalOrContainer) : modalOrContainer;
  if (!container) return;
  const textareas = container.querySelectorAll ? container.querySelectorAll('.auto-textarea') : [container];
  textareas.forEach(t => {
    if (t._autoResize) {
      t._autoResize();
    } else {
      t.style.height = '68px';
    }
  });
}

/**
 * Priority Badge HTML Generator with 4-Tier Visual Dots
 */
export function getPriorityBadge(priority) {
  const p = (priority || 'medium').toLowerCase();
  const label = i18n.t(`priority${p.charAt(0).toUpperCase() + p.slice(1)}`) || p;
  return `<span class="badge-priority ${p}">● ${label}</span>`;
}

/**
 * Render Plan Column (Whole Card Click-to-Select)
 */
export function renderPlanColumn(plans, selectedPlanId) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('planColBody');
  const countBadge = document.getElementById('planColCount');
  if (!container) return;

  countBadge.textContent = plans.length;

  if (plans.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-title">${i18n.t('emptyPlanTitle')}</div>
        <div class="empty-state-desc">${i18n.t('emptyPlanDesc')}</div>
        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap; justify-content: center;">
          <button class="btn btn-primary btn-sm" id="emptyStateNewPlanBtn">${i18n.t('newPlanBtn')}</button>
          <button class="btn btn-secondary btn-sm" id="emptyStateLoadSeedBtn">${i18n.t('loadExampleBtn')}</button>
        </div>
      </div>
    `;
    return;
  }

  let html = '';
  for (const plan of plans) {
    const isSelected = plan.id === selectedPlanId;
    const selectedClass = isSelected ? 'selected-card' : '';
    const planMinutes = Number(plan.estimated_hours) || 0;

    html += `
      <div class="card plan-card ${selectedClass}" data-plan-id="${plan.id}">
        <div class="card-header">
          <div class="card-title">${escapeHtml(plan.title)}</div>
          ${getPriorityBadge(plan.priority)}
        </div>
        <div class="card-meta">
          <span>${escapeHtml(plan.period_start)} ~ ${escapeHtml(plan.period_end)} (${i18n.t('tzLabel')})</span>
          <span>${planMinutes}${i18n.t('minutesUnit')}</span>
          ${isSelected ? `<span class="badge-status active">${i18n.t('selectedBadge')}</span>` : ''}
        </div>
        ${plan.success_criteria ? `<div class="card-body-text" style="font-size: 0.78rem; opacity: 0.85;">${i18n.t('targetLabel')} ${escapeHtml(plan.success_criteria)}</div>` : ''}
        <div class="card-actions">
          <div style="font-size: 0.74rem; color: var(--color-text-muted);">
            ${isSelected ? `✓ ${i18n.t('selectedBadge')}` : ''}
          </div>
          <div style="display: flex; gap: 0.3rem;" class="action-btn-group">
            <button class="btn btn-secondary btn-sm plan-history-btn" data-plan-id="${plan.id}" title="${i18n.t('historyBtn')}">${i18n.t('historyBtn')}</button>
            <button class="btn btn-secondary btn-sm edit-plan-btn" data-plan-id="${plan.id}" title="${i18n.t('editBtn')}">${i18n.t('editBtn')}</button>
            <button class="btn btn-secondary btn-sm delete-plan-btn" data-plan-id="${plan.id}" title="${i18n.t('deleteBtn')}">${i18n.t('deleteBtn')}</button>
          </div>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

/**
 * Render Do Column (To Dos, Execution logs & Multi-Tag Filters)
 */
export function renderDoColumn(todos, doLogs, selectedPlan, activeTags = []) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('doColBody');
  const countBadge = document.getElementById('doColCount');
  if (!container) return;

  countBadge.textContent = todos.length;

  if (todos.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-state-icon">✓</div>
        <div class="empty-state-title">${i18n.t('emptyDoTitle')}</div>
        <div class="empty-state-desc">${i18n.t('emptyDoDesc')}</div>
        ${selectedPlan ? `<button class="btn btn-primary btn-sm" id="emptyStateNewTodoBtn" style="margin-top: 0.5rem;">${i18n.t('addTodoBtn')}</button>` : ''}
      </div>
    `;
    return;
  }

  let html = '';
  
  if (activeTags && activeTags.length > 0) {
    html += `
      <div style="display: flex; align-items: center; justify-content: space-between; background: var(--color-primary-light); padding: 0.4rem 0.65rem; border-radius: var(--radius-sm); font-size: 0.78rem; flex-wrap: wrap; gap: 0.35rem;">
        <div style="display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap;">
          <span style="font-weight: 600; color: var(--color-text-main);">${i18n.t('tagFilterActive')}:</span>
          ${activeTags.map(tg => `
            <span class="active-tag-badge" style="display: inline-flex; align-items: center; gap: 0.25rem; background: var(--color-primary); color: #fff; padding: 0.1rem 0.4rem; border-radius: var(--radius-full); font-size: 0.72rem; font-weight: 600;">
              #${escapeHtml(tg)}
              <button class="remove-single-tag-btn" data-tag="${escapeHtml(tg)}" style="background: none; border: none; color: #fff; cursor: pointer; padding: 0; font-size: 0.75rem; font-weight: 800;">✕</button>
            </span>
          `).join('')}
        </div>
        <button class="btn btn-sm clear-all-tags-btn" style="background: none; border: none; padding: 0; cursor: pointer; color: var(--color-primary); font-weight: 700; font-size: 0.75rem;">
          ✕ ${i18n.getLang() === 'ko' ? '전체 해제' : 'Clear All'}
        </button>
      </div>
    `;
  }

  for (const todo of todos) {
    const todoLogs = doLogs.filter(l => String(l.todo_id) === String(todo.id));
    const totalActualMins = todoLogs.reduce((sum, l) => sum + (Number(l.actual_minutes) || 0), 0);
    const isDateDelayed = isDelayedKST(todo.due_date, todo.is_completed);
    const isTimeOverrun = totalActualMins > (parseInt(todo.estimated_minutes, 10) || 0);
    const isDelayed = isDateDelayed || isTimeOverrun;
    const hasBlocker = todoLogs.some(l => l.blocked_reason && l.blocked_reason.trim().length > 0);
    const latestBlocker = todoLogs.find(l => l.blocked_reason && l.blocked_reason.trim().length > 0)?.blocked_reason;

    html += `
      <div class="card todo-card" data-todo-id="${todo.id}">
        <div class="todo-check-wrap">
          <div class="custom-checkbox ${todo.is_completed ? 'checked' : ''}" data-todo-id="${todo.id}" title="Toggle Complete">
            ${todo.is_completed ? '✓' : ''}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div class="card-title todo-title ${todo.is_completed ? 'completed' : ''}">${escapeHtml(todo.title)}</div>
            <div class="card-meta" style="margin-top: 0.25rem;">
              ${getPriorityBadge(todo.priority)}
              <span style="${isDateDelayed ? 'color: #ef4444; font-weight: 700;' : ''}">
                ${i18n.t('dueLabel')} ${escapeHtml(todo.due_date)}${isDateDelayed ? ` ${i18n.t('delayedBadge')}` : ''}
              </span>
              <span style="${isTimeOverrun ? 'color: #ef4444; font-weight: 700;' : ''}">
                ${i18n.t('estimatedLabel')} ${escapeHtml(todo.estimated_minutes)}${i18n.t('minutesUnit')}${totalActualMins > 0 ? ` | ${i18n.t('actualLabel')} ${totalActualMins}${i18n.t('minutesUnit')}` : ''}${isTimeOverrun ? ` (${i18n.getLang() === 'ko' ? '초과' : 'Overrun'})` : ''}
              </span>
            </div>
          </div>
        </div>

        ${todo.description ? `<div class="card-body-text">${escapeHtml(todo.description)}</div>` : ''}

        ${todo.tags && todo.tags.length > 0 ? `
          <div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">
            ${todo.tags.map(t => {
              const isActive = activeTags && activeTags.includes(t);
              return `<button type="button" class="tag-chip tag-filter-chip ${isActive ? 'active-tag' : ''}" data-tag="${escapeHtml(t)}" style="cursor: pointer; border: 1px solid var(--color-border); background: ${isActive ? 'var(--color-primary)' : 'var(--color-bg-surface-subtle)'}; color: ${isActive ? '#fff' : 'inherit'}; border-radius: var(--radius-full); font-size: 0.72rem; padding: 0.1rem 0.45rem;">#${escapeHtml(t)}</button>`;
            }).join('')}
          </div>
        ` : ''}

        ${hasBlocker ? `
          <div class="blocker-callout">
            <span><strong>${i18n.t('blockedReasonLabel')}</strong> ${escapeHtml(latestBlocker)}</span>
          </div>
        ` : ''}

        <div class="card-actions">
          <button class="btn btn-secondary btn-sm log-exec-btn" data-todo-id="${todo.id}">
            ${i18n.t('logTimeBtn')}
          </button>
          <div style="display: flex; gap: 0.3rem;">
            <button class="btn btn-secondary btn-sm edit-todo-btn" data-todo-id="${todo.id}">${i18n.t('editBtn')}</button>
            <button class="btn btn-secondary btn-sm delete-todo-btn" data-todo-id="${todo.id}">${i18n.t('deleteBtn')}</button>
          </div>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

/**
 * Render See Column (KST/EDT Analytics & Feedback Loop)
 */
export function renderSeeColumn(metrics, selectedPlan, seeReviews) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('seeColBody');
  if (!container) return;

  if (metrics.plannedCount === 0) {
    container.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-state-icon">📊</div>
        <div class="empty-state-title">${i18n.t('emptySeeTitle')}</div>
        <div class="empty-state-desc">${i18n.t('emptySeeDesc')}</div>
      </div>
    `;
    return;
  }

  const sign = metrics.timeDeltaMinutes > 0 ? '+' : '';
  const timeDeltaColor = metrics.timeDeltaMinutes > 0 ? '#ef4444' : metrics.timeDeltaMinutes < 0 ? '#10b981' : 'inherit';

  let html = `
    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">${i18n.t('metricPlanned')}</div>
        <div class="metric-value">${metrics.plannedCount}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">${i18n.t('metricCompleted')}</div>
        <div class="metric-value highlight-completed">${metrics.completedCount}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">${i18n.t('metricDelayed')}</div>
        <div class="metric-value ${metrics.delayedCount > 0 ? 'highlight-delayed' : ''}">${metrics.delayedCount}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">${i18n.t('metricBlocked')}</div>
        <div class="metric-value ${metrics.blockedCount > 0 ? 'highlight-blocked' : ''}">${metrics.blockedCount}</div>
      </div>
    </div>

    <div class="card" style="margin-top: 0.25rem;">
      <div class="card-header">
        <div class="card-title">${i18n.t('metricTimeDelta')}</div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
        <span>${i18n.t('estimatedLabel')} <strong>${metrics.totalEstimatedMin}${i18n.t('minutesUnit')}</strong></span>
        <span>${i18n.t('actualLabel')} <strong>${metrics.totalActualMin}${i18n.t('minutesUnit')}</strong></span>
      </div>
      <div style="font-size: 1.1rem; font-weight: 700; color: ${timeDeltaColor}; margin-top: 0.25rem;">
        ${i18n.t('varianceLabel')} ${sign}${metrics.timeDeltaMinutes}${i18n.t('minutesUnit')}
      </div>
    </div>

    <div class="feedback-loop-box">
      <div style="font-weight: 700; font-size: 0.95rem; color: var(--color-text-main);">
        ${i18n.t('feedbackLoopTitle')}
      </div>
      <div style="font-size: 0.8rem; color: var(--color-text-muted);">
        ${i18n.t('feedbackLoopDesc')}
      </div>
      <button class="btn btn-primary btn-sm" id="advanceFeedbackLoopBtn" style="margin-top: 0.35rem;">
        ${i18n.t('advanceFeedbackBtn')}
      </button>
    </div>
  `;

  if (seeReviews.length > 0) {
    html += `
      <div style="margin-top: 0.5rem;">
        <div style="font-weight: 700; font-size: 0.85rem; margin-bottom: 0.4rem; color: var(--color-text-muted);">
          ${i18n.t('previousReflectionsTitle')}
        </div>
        ${seeReviews.map(r => `
          <div class="card" style="margin-bottom: 0.5rem; font-size: 0.8rem;">
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--color-text-muted);">
              <span>${escapeHtml(r.review_date)} (${i18n.t('tzLabel')})</span>
              <span>✓ ${r.completed_count}/${r.planned_count}</span>
            </div>
            <div style="margin-top: 0.25rem; font-weight: 500;">
              ${escapeHtml(r.adjustment_insight)}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  container.innerHTML = html;
}

/**
 * Render Plan Revision History Modal strictly formatted to active timezone
 */
export function renderPlanHistoryModal(plan, histories) {
  if (typeof document === 'undefined') return;
  const titleEl = document.getElementById('historyModalPlanTitle');
  const listEl = document.getElementById('historyModalList');
  if (titleEl) titleEl.textContent = plan ? `${i18n.t('historyModalTitle')}: ${plan.title}` : i18n.t('historyModalTitle');
  
  if (!listEl) return;

  if (histories.length === 0) {
    listEl.innerHTML = `
      <div style="text-align: center; color: var(--color-text-muted); padding: 1.5rem;">
        ${i18n.t('noHistoryText')}
      </div>
    `;
    return;
  }

  listEl.innerHTML = histories.map(h => `
    <div class="history-item">
      <div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 0.85rem;">
        <span>${i18n.t('revisionNumberLabel')}${h.revision_number}</span>
        <span style="font-size: 0.75rem; color: var(--color-text-muted);">${formatLocalizedDateTime(h.changed_at, i18n.getLang())} (${i18n.t('tzLabel')})</span>
      </div>
      <div style="margin-top: 0.35rem; font-size: 0.85rem;"><strong>Title:</strong> ${escapeHtml(h.title)}</div>
      <div style="font-size: 0.78rem; color: var(--color-text-muted); margin-top: 0.2rem;">
        ${escapeHtml(h.period_start)} ~ ${escapeHtml(h.period_end)} | ${escapeHtml(h.estimated_hours)}${i18n.t('minutesUnit')} | ${getPriorityBadge(h.priority)}
      </div>
      ${h.success_criteria ? `<div style="font-size: 0.78rem; margin-top: 0.2rem;">${i18n.t('targetLabel')} ${escapeHtml(h.success_criteria)}</div>` : ''}
      <div style="font-size: 0.75rem; color: var(--color-primary); margin-top: 0.25rem;">Reason: ${escapeHtml(h.reason)}</div>
    </div>
  `).join('');
}

/**
 * Updates all static UI texts when language changes
 */
export function applyLanguageTranslations() {
  if (typeof document === 'undefined') return;
  const t = (k) => i18n.t(k);

  // Header & Controls
  document.getElementById('exportBtn').textContent = t('exportBtn');
  document.getElementById('importBtn').textContent = t('importBtn');
  document.getElementById('resetScopeBtn').textContent = t('resetBtn');
  document.getElementById('headerNewPlanText').textContent = t('newPlanBtn');

  // Filter bar
  document.getElementById('searchInput').placeholder = t('searchPlaceholder');

  // Plan Priority Filter options in Column 1
  const planPriorityFilter = document.getElementById('planPriorityFilter');
  if (planPriorityFilter) {
    const cur = planPriorityFilter.value;
    planPriorityFilter.innerHTML = `
      <option value="all">${t('allPlanPriorities')}</option>
      <option value="urgent">${t('priorityUrgent')}</option>
      <option value="high">${t('priorityHigh')}</option>
      <option value="medium">${t('priorityMedium')}</option>
      <option value="low">${t('priorityLow')}</option>
    `;
    planPriorityFilter.value = cur;
  }

  // To Do Priority Filter options in Filter bar
  const priorityFilter = document.getElementById('priorityFilter');
  if (priorityFilter) {
    const cur = priorityFilter.value;
    priorityFilter.innerHTML = `
      <option value="all">${t('allTodoPriorities')}</option>
      <option value="urgent">${t('priorityUrgent')}</option>
      <option value="high">${t('priorityHigh')}</option>
      <option value="medium">${t('priorityMedium')}</option>
      <option value="low">${t('priorityLow')}</option>
    `;
    priorityFilter.value = cur;
  }

  // Status Filter options
  const statusFilter = document.getElementById('statusFilter');
  if (statusFilter) {
    const cur = statusFilter.value;
    statusFilter.innerHTML = `
      <option value="all">${t('allStatus')}</option>
      <option value="in_progress">${t('statusInProgress')}</option>
      <option value="completed">${t('statusCompleted')}</option>
      <option value="delayed">${t('statusDelayed')}</option>
    `;
    statusFilter.value = cur;
  }

  // Plan Sort Filter options
  const planSortSelect = document.getElementById('planSortSelect');
  if (planSortSelect) {
    const cur = planSortSelect.value;
    planSortSelect.innerHTML = `
      <option value="created_desc">${t('sortCreated')}</option>
      <option value="end_asc">${t('sortDueDate')}</option>
      <option value="start_asc">${t('sortStartDate')}</option>
      <option value="priority_desc">${t('sortPriority')}</option>
    `;
    planSortSelect.value = cur;
  }

  // To Do Sort Filter options
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    const cur = sortSelect.value;
    sortSelect.innerHTML = `
      <option value="due_asc">${t('sortDueDate')}</option>
      <option value="priority_desc">${t('sortPriority')}</option>
      <option value="created_desc">${t('sortCreated')}</option>
    `;
    sortSelect.value = cur;
  }

  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.textContent = val;
  };
  const setPH = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.placeholder = val;
  };

  // Column Buttons
  setTxt('colAddPlanBtn', t('addPlanBtn'));
  setTxt('colAddTodoBtn', t('addTodoBtn'));
  setTxt('colReflectBtn', t('reflectBtn'));

  // Modals - Plan Modal
  setTxt('modalPlanTitleLabel', t('planTitleLabel'));
  setPH('planTitleInput', t('planTitlePlaceholder'));
  setTxt('modalPlanStartLabel', t('startDateLabel'));
  setTxt('modalPlanEndLabel', t('endDateLabel'));
  setTxt('modalPlanPriorityLabel', t('priorityLabel'));
  setTxt('modalPlanHoursLabel', t('estimatedHoursLabel'));
  setPH('planHoursInput', t('estimatedHoursPlaceholder'));
  setTxt('modalPlanCriteriaLabel', t('successCriteriaLabel'));
  setPH('planCriteriaInput', t('successCriteriaPlaceholder'));
  setTxt('modalPlanRevisionReasonLabel', t('revisionReasonLabel'));
  setPH('planRevisionReasonInput', t('revisionReasonPlaceholder'));
  setTxt('planModalCancelBtn', t('cancelBtn'));
  setTxt('planFormSubmitText', t('savePlanBtn'));
  setTxt('planReplicateTodosLabel', t('replicateTodosLabel'));

  // To Do Modal
  setTxt('modalTodoPlanLabel', t('linkedPlanLabel'));
  setTxt('modalTodoTitleLabel', t('todoTitleLabel'));
  setPH('todoTitleInput', t('todoTitlePlaceholder'));
  setTxt('modalTodoDueLabel', t('dueDateLabel'));
  setTxt('modalTodoPriorityLabel', t('priorityLabel'));
  setTxt('modalTodoMinutesLabel', t('estimatedMinutesLabel'));
  setTxt('modalTodoTagsLabel', t('tagsLabel'));
  setPH('todoTagsInput', t('tagsPlaceholder'));
  setTxt('modalTodoDescLabel', t('descriptionLabel'));
  setPH('todoDescInput', t('descriptionPlaceholder'));
  setTxt('todoModalCancelBtn', t('cancelBtn'));
  setTxt('todoFormSubmitText', t('saveTodoBtn'));

  // Priority Pill Labels
  document.querySelectorAll('#planPriorityPills .priority-pill-btn, #todoPriorityPills .priority-pill-btn').forEach(btn => {
    const p = btn.dataset.priority;
    if (p) btn.textContent = t(`priority${p.charAt(0).toUpperCase() + p.slice(1)}`);
  });

  // Exec Modal
  setTxt('execLiveTimerLabel', t('liveTimerLabel'));
  setTxt('execTimerStartBtn', t('startTimerBtn'));
  setTxt('execTimerStopBtn', t('stopTimerBtn'));
  setTxt('execTimerResetBtn', t('resetTimerBtn'));
  setTxt('modalExecStartLabel', t('startTimeLabel'));
  setTxt('modalExecEndLabel', t('endTimeLabel'));
  setTxt('modalExecMinutesLabel', t('actualMinutesLabel'));
  setTxt('modalExecBlockerLabel', t('blockedInputLabel'));
  setPH('execBlockerInput', t('blockedInputPlaceholder'));
  setTxt('execModalCancelBtn', t('cancelBtn'));
  setTxt('execSaveLogOnlyBtn', t('saveLogOnlyBtn'));
  setTxt('execCompleteAndLogBtn', t('completeAndLogBtn'));

  // Reflection Modal
  setTxt('seeModalTitle', t('seeModalTitle'));
  setTxt('modalSeeDateLabel', t('reviewDateLabel'));
  setTxt('modalSeeInsightLabel', t('insightLabel'));
  setPH('seeInsightInput', t('insightPlaceholder'));
  setTxt('seeModalCancelBtn', t('cancelBtn'));
  setTxt('seeFormSubmitBtn', t('saveReflectionBtn'));

  // Dirty Modal
  setTxt('dirtyModalTitle', t('dirtyModalTitle'));
  setTxt('dirtyModalBody', t('dirtyModalBody'));
  setTxt('dirtyConfirmKeepBtn', t('keepEditingBtn'));
  setTxt('dirtyConfirmDiscardBtn', t('discardBtn'));

  // Reset Modal
  setTxt('resetModalTitle', t('resetModalTitle'));
  setTxt('resetModalCancelBtn', t('cancelBtn'));
  setTxt('resetModalSeedBtn', t('resetSeedBtn'));
  setTxt('resetModalConfirmBtn', t('resetConfirmBtn'));

  // Import Modal
  setTxt('importModalTitle', t('importModalTitle'));
  setTxt('importModalDesc', t('importModalDesc'));
  setTxt('importModalCancelBtn', t('cancelBtn'));
  setTxt('importModalSubmitBtn', t('importSubmitBtn'));
}
