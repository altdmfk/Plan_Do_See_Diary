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
    this._modalTrapHandlers = new Map();
    this._openerElements = new Map();
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
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    window.addEventListener('keydown', (e) => {
      try {
        if (e.key === 'Escape' && this.activeModal) {
          this.attemptClose(this.activeModal.id);
        }
      } catch (err) {}
    });

    window.addEventListener('beforeunload', (e) => {
      try {
        if (this.isFormActuallyDirty()) {
          e.preventDefault();
          e.returnValue = i18n.t('dirtyModalBody');
          return e.returnValue;
        }
      } catch (err) {}
    });
  }

  open(modalId, triggerEl = (typeof document !== 'undefined' ? document.activeElement : null)) {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    if (triggerEl) {
      this._openerElements.set(modalId, triggerEl);
    }

    this.activeModal = modal;
    modal.classList.add('active');

    // Prevent background elements from receiving keyboard navigation / screen-reader focus
    document.querySelectorAll('.app-header, .board-filter-bar, .kanban-board, #mobileBottomNav').forEach(el => {
      el.setAttribute('aria-hidden', 'true');
      try { el.inert = true; } catch (e) {}
    });
    
    // Immediately shift focus to the first interactive element inside the modal
    const initialFocusEl = modal.querySelector('#planTitleInput, #todoTitleInput, #execMemoInput, #seeInsightInput, input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])');
    if (initialFocusEl && typeof initialFocusEl.focus === 'function') {
      initialFocusEl.focus();
    }

    requestAnimationFrame(() => {
      if (initialFocusEl && typeof initialFocusEl.focus === 'function') {
        initialFocusEl.focus();
      }
    });

    // Save initial snapshot after rendering values and trigger textarea auto-fit
    setTimeout(() => {
      try {
        this.initialSnapshot = this._captureSnapshot(modal);
        triggerTextareaResize(modal);
        if (initialFocusEl && typeof initialFocusEl.focus === 'function') {
          initialFocusEl.focus();
        } else {
          const focusables = this._getFocusableElements(modal);
          if (focusables.length > 0) {
            focusables[0].focus();
          }
        }
      } catch (err) {}
    }, 20);

    this._trapFocus(modal);
  }

  _getFocusableElements(container) {
    if (!container) return [];
    const selector = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(selector)).filter(el => {
      return !el.disabled && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
    });
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
      if (this._modalTrapHandlers.has(modal)) {
        modal.removeEventListener('keydown', this._modalTrapHandlers.get(modal));
        this._modalTrapHandlers.delete(modal);
      }
      modal.onkeydown = null;
    }

    // Restore background interactivity
    document.querySelectorAll('.app-header, .board-filter-bar, .kanban-board, #mobileBottomNav').forEach(el => {
      el.removeAttribute('aria-hidden');
      try { el.inert = false; } catch (e) {}
    });

    // Return DOM focus to the original trigger opener element
    const opener = this._openerElements.get(modalId);
    if (opener && typeof opener.focus === 'function' && document.body.contains(opener)) {
      try { opener.focus(); } catch (e) {}
    }
    this._openerElements.delete(modalId);

    this.activeModal = null;
    this.initialSnapshot = null;
  }

  close(modalId, force = false) {
    const targetId = modalId || (this.activeModal ? this.activeModal.id : null);
    if (!targetId) return;

    if (force) {
      this.forceClose(targetId);
    } else {
      this.attemptClose(targetId);
    }
  }

  hide(modalId, force = false) {
    this.close(modalId, force);
  }

  closeAll() {
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.modal-backdrop').forEach(modal => {
        modal.classList.remove('active');
        if (this._modalTrapHandlers.has(modal)) {
          modal.removeEventListener('keydown', this._modalTrapHandlers.get(modal));
          this._modalTrapHandlers.delete(modal);
        }
        modal.onkeydown = null;
      });

      // Restore background interactivity
      document.querySelectorAll('.app-header, .board-filter-bar, .kanban-board, #mobileBottomNav').forEach(el => {
        el.removeAttribute('aria-hidden');
        try { el.inert = false; } catch (e) {}
      });
    }

    this._openerElements.clear();
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
    const previousActiveElement = document.activeElement;
    confirmModal.setAttribute('tabindex', '-1');
    confirmModal.classList.add('active');

    const focusableSelector = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableElements = Array.from(confirmModal.querySelectorAll(focusableSelector)).filter(el => !el.disabled);
    const discardBtn = document.getElementById('dirtyConfirmDiscardBtn');
    const keepBtn = document.getElementById('dirtyConfirmKeepBtn');
    const initialFocusBtn = focusableElements[0] || discardBtn;

    if (initialFocusBtn) {
      initialFocusBtn.focus();
    }
    requestAnimationFrame(() => {
      if (initialFocusBtn) initialFocusBtn.focus();
    });
    setTimeout(() => {
      if (initialFocusBtn) initialFocusBtn.focus();
    }, 50);

    const cleanup = () => {
      confirmModal.classList.remove('active');
      discardBtn?.removeEventListener('click', handleDiscard);
      keepBtn?.removeEventListener('click', handleKeep);
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeydown, true);
      }
      confirmModal.onkeydown = null;
      if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
        previousActiveElement.focus();
      }
    };

    const handleDiscard = () => {
      cleanup();
      onDiscard();
    };

    const handleKeep = () => {
      cleanup();
    };

    const handleKeydown = (e) => {
      try {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          handleKeep();
          return;
        }

        const focusables = Array.from(confirmModal.querySelectorAll(focusableSelector)).filter(el => {
          return !el.disabled && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
        });
        if (focusables.length === 0) return;
        const currentIndex = focusables.indexOf(document.activeElement);

        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
          const buttons = Array.from(confirmModal.querySelectorAll('button:not([disabled])')).filter(btn => {
            return btn.offsetWidth > 0 || btn.offsetHeight > 0 || btn.getClientRects().length > 0;
          });
          if (buttons.length > 0) {
            const btnIndex = buttons.indexOf(document.activeElement);
            e.preventDefault();
            e.stopPropagation();
            if (btnIndex === -1) {
              buttons[0].focus();
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              buttons[(btnIndex + 1) % buttons.length].focus();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              buttons[(btnIndex - 1 + buttons.length) % buttons.length].focus();
            }
            return;
          }
        }

        if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            if (document.activeElement === focusables[0] || currentIndex <= 0 || !confirmModal.contains(document.activeElement)) {
              focusables[focusables.length - 1].focus();
            } else {
              focusables[currentIndex - 1].focus();
            }
          } else {
            if (document.activeElement === focusables[focusables.length - 1] || currentIndex >= focusables.length - 1 || !confirmModal.contains(document.activeElement)) {
              focusables[0].focus();
            } else {
              focusables[currentIndex + 1].focus();
            }
          }
          return;
        }

        if (e.key === 'Enter' || e.key === ' ') {
          const tag = document.activeElement?.tagName?.toLowerCase();
          // Skip automatic modal confirmation if active element is input or textarea
          if (tag === 'input' || tag === 'textarea') {
            return;
          }
          e.stopPropagation();
          if (document.activeElement && typeof document.activeElement.click === 'function') {
            document.activeElement.click();
          } else {
            handleDiscard();
          }
        }
      } catch (err) {}
    };

    discardBtn?.addEventListener('click', handleDiscard);
    keepBtn?.addEventListener('click', handleKeep);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeydown, true);
    }
  }

  _trapFocus(element) {
    if (!element) return;
    const selector = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // Remove any existing trap listener to prevent duplicates
    if (this._modalTrapHandlers.has(element)) {
      element.removeEventListener('keydown', this._modalTrapHandlers.get(element));
      this._modalTrapHandlers.delete(element);
    }
    element.onkeydown = null;

    const trapHandler = (e) => {
      try {
        // Prevent unintended submissions when pressing Enter inside single-line inputs
        if (e.key === 'Enter') {
          const isModifier = e.ctrlKey || e.metaKey;
          const targetTag = e.target?.tagName?.toLowerCase();
          const isSearchInput = e.target?.type === 'search' || (e.target?.id && e.target.id.toLowerCase().includes('search'));

          if (targetTag === 'input' && !isModifier && !isSearchInput) {
            e.preventDefault();
            return;
          }
        }

        // Arrow-key button cycling in modal action containers / footers / button groups
        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
          const targetTag = e.target?.tagName?.toLowerCase();
          if (targetTag !== 'input' && targetTag !== 'textarea' && targetTag !== 'select') {
            const container = e.target?.closest('.modal-footer, .dirty-modal-actions, .modal-actions, .priority-pills, .auth-tabs, .btn-group') || element;
            const buttons = Array.from(container.querySelectorAll('button:not([disabled]), [role="button"]:not([disabled])')).filter(btn => {
              return btn.offsetWidth > 0 || btn.offsetHeight > 0 || btn.getClientRects().length > 0;
            });

            if (buttons.length > 1) {
              const btnIndex = buttons.indexOf(document.activeElement);
              if (btnIndex !== -1) {
                e.preventDefault();
                e.stopPropagation();
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  buttons[(btnIndex + 1) % buttons.length].focus();
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  buttons[(btnIndex - 1 + buttons.length) % buttons.length].focus();
                }
                return;
              }
            }
          }
        }

        if (e.key === 'Tab') {
          const focusables = Array.from(element.querySelectorAll(selector)).filter(el => {
            return !el.disabled && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
          });

          if (focusables.length === 0) {
            e.preventDefault();
            return;
          }

          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const currentIndex = focusables.indexOf(document.activeElement);

          e.preventDefault();
          if (e.shiftKey) {
            if (document.activeElement === first || currentIndex <= 0 || !element.contains(document.activeElement)) {
              last.focus();
            } else {
              focusables[currentIndex - 1].focus();
            }
          } else {
            if (document.activeElement === last || currentIndex >= focusables.length - 1 || !element.contains(document.activeElement)) {
              first.focus();
            } else {
              focusables[currentIndex + 1].focus();
            }
          }
        }
      } catch (err) {
        // Safe fallback - avoid uncaught exceptions breaking keyboard navigation
      }
    };

    element.addEventListener('keydown', trapHandler);
    this._modalTrapHandlers.set(element, trapHandler);
  }
}

export const modalManager = new ModalManager();

export function openMigrationModal() {
  modalManager.open('migrationModal');
}

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
export function renderPlanColumn(plansOrPagination, selectedPlanId, allPlans = [], allTodos = []) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('planColBody');
  const countBadge = document.getElementById('planColCount');
  if (!container) return;

  const isPaginated = plansOrPagination && typeof plansOrPagination === 'object' && Array.isArray(plansOrPagination.items);
  const plans = isPaginated ? plansOrPagination.items : (Array.isArray(plansOrPagination) ? plansOrPagination : []);
  const totalCount = isPaginated ? plansOrPagination.totalItems : (allPlans.length || plans.length);
  const currentPage = isPaginated ? plansOrPagination.currentPage : 1;
  const totalPages = isPaginated ? plansOrPagination.totalPages : 1;
  const hasPrev = isPaginated ? plansOrPagination.hasPrev : false;
  const hasNext = isPaginated ? plansOrPagination.hasNext : false;

  countBadge.textContent = totalCount;

  if (totalCount === 0 || plans.length === 0) {
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
    const isFeedbackConverted = (allPlans || plans).some(p => p.source_plan_id === plan.id || p.parent_plan_id === plan.id);
    const planTodos = (allTodos || []).filter(t => String(t.plan_id) === String(plan.id));
    const allDosCompleted = planTodos.length > 0 && planTodos.every(t => t.is_completed || t.status === 'completed');
    const hasIncompleteDos = planTodos.some(t => !t.is_completed && t.status !== 'completed');

    // Strict completed condition:
    // If feedback converted -> completed
    // Else if has incomplete items -> strictly not completed
    // Else if all tasks completed or status is completed -> completed
    let isPlanCompleted = false;
    if (isFeedbackConverted) {
      isPlanCompleted = true;
    } else if (hasIncompleteDos) {
      isPlanCompleted = false;
    } else if (allDosCompleted || plan.status === 'completed' || plan.is_completed === true) {
      isPlanCompleted = true;
    }
    const planCompletedClass = isPlanCompleted ? 'completed feedback-linked-plan' : '';
    const titleCompletedClass = isPlanCompleted ? 'completed' : '';
    const planMinutes = Number(plan.estimated_hours) || 0;

    let statusText = '';
    let statusBadgeClass = 'active';
    if (isFeedbackConverted) {
      statusText = i18n.getLang() === 'ko' ? '피드백 연계 완료' : 'Feedback Linked';
      statusBadgeClass = 'completed';
    } else if (isPlanCompleted && !hasIncompleteDos) {
      statusText = i18n.getLang() === 'ko' ? '완료' : 'Completed';
      statusBadgeClass = 'completed';
    } else {
      statusText = i18n.getLang() === 'ko' ? '진행 중' : 'In Progress';
      statusBadgeClass = 'active';
    }

    html += `
      <div class="card plan-card ${selectedClass} ${planCompletedClass}" data-plan-id="${plan.id}" tabindex="0" ${isFeedbackConverted ? `title="${i18n.getLang() === 'ko' ? '피드백 개선 계획으로 연계된 계획' : 'Converted to feedback improvement plan'}"` : ''}>
        <div class="card-header">
          <div class="card-title plan-title ${titleCompletedClass}">${escapeHtml(plan.title)}</div>
          <div style="display: flex; align-items: center; gap: 0.35rem;">
            <span class="badge-status ${statusBadgeClass}">${escapeHtml(statusText)}</span>
            ${getPriorityBadge(plan.priority)}
          </div>
        </div>
        <div class="card-meta">
          <span>${escapeHtml(plan.period_start)} ~ ${escapeHtml(plan.period_end)} (${i18n.t('tzLabel')})</span>
          <span>${planMinutes}${i18n.t('minutesUnit')}</span>
          ${isSelected ? `<span class="badge-status active">${i18n.t('selectedBadge')}</span>` : ''}
          ${isFeedbackConverted ? `<span class="badge-status completed" style="font-size: 0.68rem; font-weight: 700;">✓ 피드백 연계</span>` : (isPlanCompleted && !hasIncompleteDos ? `<span class="badge-status completed" style="font-size: 0.68rem; font-weight: 700;">✓ 완료</span>` : '')}
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

  // Render Accessible Pagination Controls UI
  if (totalPages > 1) {
    html += `
      <nav class="pagination-container" aria-label="Plan list pagination" style="display: flex; align-items: center; justify-content: center; gap: 0.35rem; margin-top: 1rem; padding: 0.5rem 0; flex-wrap: wrap;">
        <button type="button" class="btn btn-secondary btn-sm plan-page-btn plan-page-prev" data-page="${currentPage - 1}" ${!hasPrev ? 'disabled' : ''} aria-label="${i18n.getLang() === 'ko' ? '이전 페이지' : 'Previous page'}" style="padding: 0.25rem 0.55rem; font-size: 0.78rem;">
          ‹ ${i18n.getLang() === 'ko' ? '이전' : 'Prev'}
        </button>
    `;

    for (let p = 1; p <= totalPages; p++) {
      const isCurrent = p === currentPage;
      html += `
        <button type="button" class="btn ${isCurrent ? 'btn-primary active' : 'btn-secondary'} btn-sm plan-page-btn plan-page-num" data-page="${p}" ${isCurrent ? 'aria-current="page"' : ''} style="min-width: 28px; padding: 0.25rem 0.45rem; font-size: 0.78rem; font-weight: ${isCurrent ? '700' : '500'};">
          ${p}
        </button>
      `;
    }

    html += `
        <button type="button" class="btn btn-secondary btn-sm plan-page-btn plan-page-next" data-page="${currentPage + 1}" ${!hasNext ? 'disabled' : ''} aria-label="${i18n.getLang() === 'ko' ? '다음 페이지' : 'Next page'}" style="padding: 0.25rem 0.55rem; font-size: 0.78rem;">
          ${i18n.getLang() === 'ko' ? '다음' : 'Next'} ›
        </button>
      </nav>
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
          ✕ ${i18n.t('clearAllTags')}
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
                ${i18n.t('estimatedLabel')} ${escapeHtml(todo.estimated_minutes)}${i18n.t('minutesUnit')}${totalActualMins > 0 ? ` | ${i18n.t('actualLabel')} ${totalActualMins}${i18n.t('minutesUnit')}` : ''}${isTimeOverrun ? ` (${i18n.t('overrun')})` : ''}
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

        ${todoLogs.length > 0 ? `
          <details class="todo-logs-audit" open style="margin-top: 0.4rem; padding: 0.35rem 0.5rem; background: var(--color-bg-surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 0.76rem;">
            <summary class="todo-logs-summary" style="font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.2rem; font-size: 0.72rem; cursor: pointer; user-select: none;">
              ⏱️ ${i18n.t('executionLogsTitle')} (${todoLogs.length})
            </summary>
            <div class="todo-logs-list" style="margin-top: 0.2rem;">
              ${todoLogs.map(l => {
                const startFormatted = l.execution_start ? formatLocalizedDateTime(l.execution_start, i18n.getLang()) : '-';
                const endFormatted = l.execution_end ? formatLocalizedDateTime(l.execution_end, i18n.getLang()) : '-';
                const memoText = l.memo && l.memo.trim().length > 0 ? escapeHtml(l.memo) : i18n.t('noMemo');
                return `
                  <div class="todo-log-item" data-log-id="${l.id}" data-todo-id="${todo.id}" title="${i18n.getLang() === 'ko' ? '더블클릭하여 수정' : 'Double-click to edit'}" style="padding: 0.25rem 0; border-top: 1px dashed var(--color-border); cursor: pointer;">
                    <div style="display: flex; justify-content: space-between; align-items: center; color: var(--color-text-muted); font-size: 0.73rem;">
                      <span>${startFormatted} ~ ${endFormatted}</span>
                      <div style="display: flex; align-items: center; gap: 0.35rem;">
                        <span style="font-weight: 700; color: var(--color-primary);">${l.actual_minutes || 0}${i18n.t('minutesUnit')}</span>
                        <button type="button" class="btn-delete-log delete-log-btn" data-log-id="${l.id}" title="${i18n.t('deleteBtn') || 'Delete'}">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                      </div>
                    </div>
                    <div style="margin-top: 0.15rem; color: var(--color-text-main); word-break: break-word;">📝 ${memoText}</div>
                    ${l.blocked_reason ? `<div style="margin-top: 0.15rem; color: var(--color-danger); word-break: break-word;">⚠️ ${escapeHtml(l.blocked_reason)}</div>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </details>
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

  const hasData = (metrics.totalPlansCount > 0) || (metrics.totalTodosCount > 0) || (metrics.completedCount > 0) || (metrics.plannedCount > 0) || (metrics.totalActualMin > 0);
  if (!hasData) {
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
        ${seeReviews.map(r => {
          const timestampFormatted = formatLocalizedDateTime(r.created_at || r.review_date, i18n.getLang()) || r.review_date;
          return `
          <div class="card" style="margin-bottom: 0.5rem; font-size: 0.8rem;">
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--color-text-muted);">
              <span>${escapeHtml(timestampFormatted)} (${i18n.t('tzLabel')})</span>
              <span>✓ ${r.completed_count}/${r.planned_count}</span>
            </div>
            <div style="margin-top: 0.25rem; font-weight: 500;">
              ${escapeHtml(r.adjustment_insight)}
            </div>
          </div>
        `;}).join('')}
      </div>
    `;
  }

  container.innerHTML = html;
}

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
  document.getElementById('resetDataBtn').textContent = t('resetBtn');
  document.getElementById('headerNewPlanText').textContent = t('newPlanBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.textContent = t('logoutBtn');
  const deleteAccountBtn = document.getElementById('deleteAccountBtn');
  if (deleteAccountBtn) deleteAccountBtn.textContent = t('deleteAccountBtn');

  // Filter bar
  const planSelectFilter = document.getElementById('planSelectFilter');
  if (planSelectFilter && planSelectFilter.options && planSelectFilter.options.length > 0) {
    const firstOpt = planSelectFilter.querySelector('option[value=""]');
    if (firstOpt) firstOpt.textContent = t('allPlans');
  }
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
      <option value="status">${t('sortStatus')}</option>
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
  setTxt('modalPlanStatusLabel', t('statusLabel'));

  const planStatusInput = document.getElementById('planStatusInput');
  if (planStatusInput) {
    const curVal = planStatusInput.value;
    if (i18n.getLang() === 'ko') {
      planStatusInput.innerHTML = `
        <option value="active">진행 중</option>
        <option value="draft">임시 저장</option>
        <option value="completed">완료</option>
        <option value="archived">보관됨</option>
      `;
    } else {
      planStatusInput.innerHTML = `
        <option value="active">Active</option>
        <option value="draft">Draft</option>
        <option value="completed">Completed</option>
        <option value="archived">Archived</option>
      `;
    }
    if (curVal) planStatusInput.value = curVal;
  }

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
  setTxt('modalExecMemoLabel', t('execMemoLabel'));
  setPH('execMemoInput', t('execMemoPlaceholder'));
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

  // History Modal
  setTxt('historyModalDismissBtn', t('historyModalDismissBtn'));

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

  // Delete Account Modal
  setTxt('deleteAccountModalTitle', t('deleteAccountModalTitle'));
  setTxt('deleteAccountWarningText', t('deleteAccountWarning'));
  setTxt('deleteAccountDescText', t('deleteAccountDesc'));
  setTxt('deleteAccountPromptText', t('deleteAccountPrompt'));
  setTxt('deleteAccountPhraseDisplay', t('deleteAccountConfirmPhrase'));
  setPH('deleteAccountInput', t('deleteAccountConfirmPhrase'));
  setTxt('deleteAccountCancelBtn', t('cancelBtn'));
  setTxt('deleteAccountConfirmBtn', t('deleteAccountConfirmBtn'));

  // Migration Modal
  setTxt('migrationModalTitle', t('migrationModalTitle'));
  const migrationBodyEl = document.getElementById('migrationModalBodyText');
  if (migrationBodyEl) migrationBodyEl.innerHTML = t('migrationModalBody');
  setTxt('migrationModalNoticeText', t('migrationModalNotice'));
  setTxt('migrationSkipBtn', t('migrationSkipBtn'));
  setTxt('migrationImportBtn', t('migrationImportBtn'));
}

export function updateThemeButtons(theme) {
  document.querySelectorAll('.theme-color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

export function updateLanguageButtons(lang) {
  const koBtn = document.getElementById('langKoBtn');
  const enBtn = document.getElementById('langEnBtn');
  if (koBtn) koBtn.classList.toggle('active', lang === 'ko');
  if (enBtn) enBtn.classList.toggle('active', lang === 'en');
}

/**
 * Global & Container Loading State Management (T08 UX Loading State)
 */
export function showLoading(text) {
  if (typeof document === 'undefined') return;
  const overlay = document.getElementById('globalLoadingOverlay');
  if (overlay) {
    if (text) {
      const textEl = document.getElementById('loadingText');
      if (textEl) textEl.textContent = text;
    }
    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
      overlay.classList.add('active');
    });
  }
  const board = document.getElementById('mainBoard');
  if (board) {
    board.classList.add('is-loading');
  }
}

export function hideLoading() {
  if (typeof document === 'undefined') return;
  const overlay = document.getElementById('globalLoadingOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    setTimeout(() => {
      if (!overlay.classList.contains('active')) {
        overlay.style.display = 'none';
      }
    }, 200);
  }
  const board = document.getElementById('mainBoard');
  if (board) {
    board.classList.remove('is-loading');
  }
}
