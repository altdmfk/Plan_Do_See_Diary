// --- PERSISTENT REMEMBERED EMAIL HELPERS (localStorage) ---
export function getSavedEmail() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem('remembered_email') || localStorage.getItem('saved_email') || null;
  } catch (err) {
    return null;
  }
}

export function setSavedEmail(email) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (email && email.trim()) {
      const val = email.trim();
      localStorage.setItem('remembered_email', val);
      localStorage.setItem('saved_email', val);
    } else {
      localStorage.removeItem('remembered_email');
      localStorage.removeItem('saved_email');
    }
  } catch (err) {}
}

// --- APP VISIBILITY ORCHESTRATOR ---
export function updateAppVisibility(isAuthenticated) {
  const authOverlay = document.getElementById('authOverlay');
  const mainBoard = document.getElementById('mainBoard');
  const headerEl = document.querySelector('.app-header');
  const filterBar = document.querySelector('.board-filter-bar');
  const mobileNav = document.getElementById('mobileBottomNav');
  const userEmailBadge = document.getElementById('userEmailBadge');
  const authEmail = document.getElementById('authEmail');
  const rememberEmailChk = document.getElementById('remember-email');

  if (authOverlay) authOverlay.hidden = Boolean(isAuthenticated);
  if (mainBoard) mainBoard.style.display = isAuthenticated ? '' : 'none';
  if (headerEl) headerEl.style.display = isAuthenticated ? '' : 'none';
  if (filterBar) filterBar.style.display = isAuthenticated ? '' : 'none';
  if (mobileNav) mobileNav.style.display = isAuthenticated ? '' : 'none';

  if (!isAuthenticated) {
    // Reliably restore persistent remembered email when login view is visible
    try {
      const savedEmail = getSavedEmail();
      if (savedEmail && authEmail) {
        authEmail.value = savedEmail;
        if (rememberEmailChk) rememberEmailChk.checked = true;
      }
    } catch (err) {}
  }

  if (userEmailBadge) {
    const email = authClient.getUserEmail();
    if (isAuthenticated && email) {
      userEmailBadge.textContent = email;
      userEmailBadge.style.display = 'inline-flex';
      userEmailBadge.title = `Logged in as ${email}`;
    } else {
      userEmailBadge.textContent = '';
      userEmailBadge.style.display = 'none';
    }
  }
}

/**
 * Plan-Do-See Diary - Main Orchestrator & Event Controller
 */

import { CONFIG } from './config.js';
import { appState } from '../state/state.js';
import { API } from '../api/api.js';
import { getKSTToday, formatKSTLiveClock } from '../utils/dateUtils.js';
import { i18n } from '../utils/i18n.js';
import { authClient } from '../auth/auth.js';
import {
  escapeHtml,
  showToast,
  showLoading,
  hideLoading,
  modalManager,
  setupAutoTextarea,
  updateFaviconAndBrand,
  updateThemeButtons,
  updateLanguageButtons,
  applyLanguageTranslations,
  renderPlanColumn,
  renderDoColumn,
  renderSeeColumn,
  renderPlanHistoryModal
} from '../ui/ui.js';

// Timer tracking state for Do Execution Logger
const timerState = {
  intervalId: null,
  startEpoch: null,
  elapsedSeconds: 0,
  isRunning: false,
  baseMinutes: 0
};

const activeCheckboxToggles = new Set();

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  authClient.init();
  updateAppVisibility(authClient.isAuthenticated());

  bindAuthForms();
  
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

  // Initialize data store if authenticated
  const initialSession = await authClient.getSession();
  if (initialSession && authClient.isAuthenticated()) {
    showLoading(i18n.getLang() === 'ko' ? '데이터를 불러오는 중입니다...' : 'Loading data...');
    try {
      updateAppVisibility(true);
      await appState.init();

      if (API.hasPendingLocalMigration()) {
        modalManager.open('migrationModal');
      }
    } catch (err) {
      if (err.status === 401 || (err.message && err.message.includes('401'))) {
        authClient.clearSession();
        API.clearSession();
        appState.resetGlobalState();
        updateAppVisibility(false);
      }
    } finally {
      hideLoading();
    }
  } else {
    updateAppVisibility(false);
  }

  // Isolated session management for current tab
  if (typeof authClient !== 'undefined' && typeof authClient.onAuthStateChange === 'function') {
    authClient.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        API.clearSession();
        appState.resetGlobalState();
        modalManager.closeAll();
        updateAppVisibility(false);
      }
    });
  }
});

function bindAuthForms() {
  const loginBtn = document.getElementById('loginBtn');
  const signupBtn = document.getElementById('signupBtn');
  const authEmail = document.getElementById('authEmail');
  const authPassword = document.getElementById('authPassword');
  const authErrorMsg = document.getElementById('authErrorMsg');
  const authForm = document.getElementById('authForm');
  const rememberEmailChk = document.getElementById('remember-email') || document.getElementById('rememberEmailChk');
  let isSubmittingAuth = false;

  // Restore saved email on page load
  const savedEmail = getSavedEmail();
  if (savedEmail && authEmail) {
    authEmail.value = savedEmail;
    if (rememberEmailChk) rememberEmailChk.checked = true;
  }

  rememberEmailChk?.addEventListener('change', () => {
    if (rememberEmailChk.checked) {
      if (authEmail?.value?.trim()) {
        setSavedEmail(authEmail.value.trim());
      }
    } else {
      setSavedEmail(null);
    }
  });

  const clearAuthError = () => {
    if (authErrorMsg) authErrorMsg.textContent = '';
  };

  authEmail?.addEventListener('input', () => {
    clearAuthError();
  });
  authPassword?.addEventListener('input', clearAuthError);

  const handleAuth = async (action) => {
    if (isSubmittingAuth) return;
    const email = authEmail.value;
    const password = authPassword.value;
    if (!email || !password) {
      authErrorMsg.style.color = 'var(--color-danger)';
      authErrorMsg.textContent = i18n.getLang() === 'ko' ? '이메일과 비밀번호를 입력해주세요.' : 'Please enter email and password';
      return;
    }

    if (action === 'signup' && password.length < 6) {
      authErrorMsg.style.color = 'var(--color-danger)';
      authErrorMsg.textContent = '비밀번호는 최소 6자 이상이어야 합니다.';
      return;
    }
    
    isSubmittingAuth = true;
    loginBtn.disabled = true;
    signupBtn.disabled = true;
    clearAuthError();
    
    try {
      if (action === 'login') {
        showLoading(i18n.getLang() === 'ko' ? '로그인 처리 중입니다...' : 'Signing in...');
        const result = await authClient.login(email, password);
        if (result && (result.code || result.error_code || !result.success)) {
          hideLoading();
          authErrorMsg.style.color = 'var(--color-danger)';
          authErrorMsg.textContent = result.msg || '아이디 또는 비밀번호가 올바르지 않습니다.';
          return;
        }
        // Strictly await session persistence before mounting and fetching data
        await authClient.getSession();

        if (rememberEmailChk && rememberEmailChk.checked) {
          setSavedEmail(email.trim());
        } else {
          setSavedEmail(null);
        }
        // Flush previous user data before fetching fresh state
        appState.resetGlobalState();
        API.clearSession();
        updateAppVisibility(true);
        initTheme();
        await appState.init();
        authEmail.value = '';
        authPassword.value = '';

        // Prompt migration if local legacy data exists and has not been migrated
        if (API.hasPendingLocalMigration()) {
          modalManager.open('migrationModal');
        }
      } else if (action === 'signup') {
        showLoading(i18n.getLang() === 'ko' ? '회원가입 처리 중입니다...' : 'Creating account...');
        const result = await authClient.signup(email, password);
        if (result && (result.code || result.error_code || !result.success)) {
          hideLoading();
          authErrorMsg.style.color = 'var(--color-danger)';
          authErrorMsg.textContent = result.msg || '회원가입 처리 중 오류가 발생했습니다.';
          return;
        }

        if (result?.session?.access_token) {
          isSubmittingAuth = false;
          await handleAuth('login');
          return;
        }

        if (authPassword) authPassword.value = '';
        authErrorMsg.style.color = 'var(--color-primary)';
        authErrorMsg.textContent = i18n.getLang() === 'ko' ? '계정이 생성되었습니다. 로그인해 주세요.' : 'Account created successfully. Please log in.';
        setTimeout(() => {
          if (authErrorMsg && (authErrorMsg.textContent.includes('생성') || authErrorMsg.textContent.includes('created'))) authErrorMsg.textContent = '';
        }, 4000);
      }
    } catch (e) {
      authErrorMsg.style.color = 'var(--color-danger)';
      authErrorMsg.textContent = e?.msg || e?.message || '처리 중 오류가 발생했습니다.';
    } finally {
      hideLoading();
      isSubmittingAuth = false;
      loginBtn.disabled = false;
      signupBtn.disabled = false;
    }
  };

  if (authForm) {
    authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleAuth('login');
    });
  }

  loginBtn?.addEventListener('click', (e) => { e.preventDefault(); clearAuthError(); handleAuth('login'); });
  signupBtn?.addEventListener('click', (e) => { e.preventDefault(); clearAuthError(); handleAuth('signup'); });
}

function initTheme() {
  const uid = typeof authClient !== 'undefined' && typeof authClient.getUserId === 'function' ? authClient.getUserId() : null;
  const userSavedTheme = uid && typeof localStorage !== 'undefined' ? localStorage.getItem(`pds_theme_${uid}`) : null;
  const globalSavedTheme = typeof localStorage !== 'undefined' ? (localStorage.getItem('pds_theme_pref') || localStorage.getItem(CONFIG.STORAGE_KEYS.ACTIVE_THEME)) : null;
  const currentTheme = userSavedTheme || globalSavedTheme || appState.getState().theme || CONFIG.DEFAULT_THEME;
  appState.setTheme(currentTheme);
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

function setupAutoExpandingTextareas() {
  document.querySelectorAll('.auto-textarea').forEach(el => setupAutoTextarea(el));
}

// --- STATE SYNCHRONIZATION ---
function onStateChange(state) {
  if (!state) return;

  if (state.loading) {
    showLoading();
  } else {
    hideLoading();
  }

  const plans = state.plans || [];
  const todos = state.todos || [];
  const do_logs = state.do_logs || [];
  const see_reviews = state.see_reviews || state.reviews || [];
  const filters = state.filters || {};

  // Update Active Plan Selector in Filter Bar
  const planSelect = document.getElementById('planSelectFilter');
  if (planSelect) {
    const filterVal = filters.planId || '';
    planSelect.innerHTML = `<option value="">${i18n.t('allPlans')} (${plans.length})</option>` +
      plans.map(p => `<option value="${p.id}" ${p.id === filterVal ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('');
    planSelect.value = filterVal;
  }

  // Update Plan Status & Priority Filter Dropdowns in Plan Column Header
  const planStatusSelect = document.getElementById('planStatusFilter');
  if (planStatusSelect && filters.planStatus !== undefined) {
    planStatusSelect.value = filters.planStatus;
  }
  const planPrioritySelect = document.getElementById('planPriorityFilter');
  if (planPrioritySelect && filters.planPriority !== undefined) {
    planPrioritySelect.value = filters.planPriority;
  }

  // Render Plan Column with paginated plans, selected plan ID, all plans, and all todos
  const paginatedPlans = appState.getPaginatedPlans();
  renderPlanColumn(paginatedPlans, state.selectedPlanId, plans, todos);

  // Render Do Column with search/status/priority/tags filtered To Dos
  const filteredTodos = appState.getFilteredTodos();
  const selectedPlan = plans.find(p => p.id === state.selectedPlanId);
  renderDoColumn(filteredTodos, do_logs, selectedPlan, filters.tags || []);

  // Render See Column
  const metrics = appState.getKSTMetrics();
  renderSeeColumn(metrics, selectedPlan, see_reviews);

  // Retrospective Action Guard: Disable "Write Retrospective" button when no corresponding "Do" entry exists
  const reflectBtn = document.getElementById('colReflectBtn');
  if (reflectBtn) {
    const selectedPlanId = state.selectedPlanId;
    const planTodos = selectedPlanId 
      ? todos.filter(t => String(t.plan_id) === String(selectedPlanId))
      : todos;
    const hasDoEntry = planTodos.length > 0;
    reflectBtn.disabled = !hasDoEntry;
    if (!hasDoEntry) {
      reflectBtn.title = i18n.getLang() === 'ko' ? '해당 계획에 등록된 할 일(Do)이 없어 회고를 작성할 수 없습니다.' : 'Cannot write retrospective: No Do entries exist for this plan.';
    } else {
      reflectBtn.title = '';
    }
  }

  // Update mobile nav state
  updateMobileNavState(state.activeMobileTab || 'plan');
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
  document.getElementById('exportBtn')?.addEventListener('click', async () => {
    try {
      const backup = await API.exportBackup();
      const jsonStr = JSON.stringify(backup, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pds-diary-${getKSTToday()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showToast(i18n.t('backupExported'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Import JSON Backup Modal
  document.getElementById('importBtn')?.addEventListener('click', () => {
    const importInput = document.getElementById('importFileInput');
    if (importInput) importInput.value = '';
    modalManager.open('importModal');
  });

  // Reset Data Modal
  document.getElementById('resetDataBtn')?.addEventListener('click', () => {
    modalManager.open('resetModal');
  });

  // New Plan Header Button
  document.getElementById('headerNewPlanBtn')?.addEventListener('click', openCreatePlanModal);

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await authClient.logout();
    API.clearSession();
    appState.clearAll();
    updateAppVisibility(false);
    showToast(i18n.getLang() === 'ko' ? '로그아웃되었습니다.' : 'Logged out successfully.', 'info');
  });

  // Delete Account UI trigger
  const deleteAccountInput = document.getElementById('deleteAccountInput');
  const deleteAccountConfirmBtn = document.getElementById('deleteAccountConfirmBtn');

  const checkDeletePhrase = () => {
    const val = deleteAccountInput ? deleteAccountInput.value.trim() : '';
    const localizedPhrase = i18n.t('deleteAccountConfirmPhrase');
    const isValid = (val === localizedPhrase) || (val === '계정을 삭제하겠습니다.');
    if (deleteAccountConfirmBtn) {
      deleteAccountConfirmBtn.disabled = !isValid;
    }
  };

  if (deleteAccountInput) {
    deleteAccountInput.addEventListener('input', checkDeletePhrase);
    deleteAccountInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && deleteAccountConfirmBtn && !deleteAccountConfirmBtn.disabled) {
        e.preventDefault();
        deleteAccountConfirmBtn.click();
      } else if (e.key === 'Enter') {
        e.preventDefault();
      }
    });
  }

  const handleDeleteModalKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleDeleteModalKeydown);
      }
      modalManager.close('deleteAccountModal');
    }
  };

  document.getElementById('deleteAccountBtn')?.addEventListener('click', () => {
    if (deleteAccountInput) {
      deleteAccountInput.value = '';
    }
    if (deleteAccountConfirmBtn) {
      deleteAccountConfirmBtn.disabled = true;
    }
    modalManager.open('deleteAccountModal');
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleDeleteModalKeydown);
    }
    requestAnimationFrame(() => {
      deleteAccountInput?.focus();
    });
  });

  document.getElementById('deleteAccountCancelBtn')?.addEventListener('click', () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleDeleteModalKeydown);
    }
    modalManager.close('deleteAccountModal');
  });

  deleteAccountConfirmBtn?.addEventListener('click', async () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleDeleteModalKeydown);
    }
    modalManager.close('deleteAccountModal');
    try {
      showLoading(i18n.getLang() === 'ko' ? '계정 및 데이터를 영구 삭제하는 중입니다...' : 'Deleting account and data...');

      // Step 1: Purge cloud data and user account
      await API.purgeUserData();
      if (typeof authClient.deleteAccount === 'function') {
        await authClient.deleteAccount();
      }

      // Step 2: Sign out from Supabase Auth
      await authClient.logout();

      // Step 3: Force-close all modals via ModalManager
      modalManager.closeAll();

      // Step 4: Clear all in-memory state
      API.clearSession();
      appState.resetGlobalState();

      // Step 5: Clear browser storage completely without preserving any fake purge markers
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.clear();
      }
      if (typeof localStorage !== 'undefined') {
        const savedEmail = getSavedEmail();
        const preserved = {
          saved_email: savedEmail,
          remembered_email: savedEmail,
          pds_active_lang: localStorage.getItem('pds_active_lang'),
          pds_theme_pref: localStorage.getItem('pds_theme_pref'),
          [CONFIG.STORAGE_KEYS.ACTIVE_THEME]: localStorage.getItem(CONFIG.STORAGE_KEYS.ACTIVE_THEME)
        };
        localStorage.clear();
        Object.entries(preserved).forEach(([k, v]) => {
          if (v) localStorage.setItem(k, v);
        });
      }

      // Step 6: Reset UI to login screen
      updateAppVisibility(false);
      showToast(i18n.t('deleteAccountSuccess'), 'success');
    } catch (err) {
      showToast(i18n.t('deleteAccountError'), 'error');
    } finally {
      hideLoading();
    }
  });

  // T06 Migration Modal
  document.getElementById('migrationModalCloseBtn')?.addEventListener('click', () => {
    modalManager.close('migrationModal');
  });
  document.getElementById('migrationSkipBtn')?.addEventListener('click', () => {
    try {
      const userId = authClient.getUserId();
      if (userId && typeof localStorage !== 'undefined') {
        localStorage.setItem(`pds_migrated_${userId}`, 'true');
      }
    } catch (e) {}
    modalManager.close('migrationModal');
  });
  document.getElementById('migrationImportBtn')?.addEventListener('click', async () => {
    try {
      await API.migrateLocalData();
      modalManager.close('migrationModal');
      await appState.init();
      showToast(i18n.t('migrationSuccess'), 'success');
    } catch (err) {
      showToast(i18n.t('importErrorPrefix') + err.message, 'error');
    }
  });
}

// --- FILTER CONTROLS ---
function bindFilterControls() {
  document.getElementById('planSelectFilter')?.addEventListener('change', (e) => {
    const val = e.target.value || '';
    showLoading();
    appState.setFilters({ planId: val });
    if (val) {
      appState.setSelectedPlan(val);
    }
    requestAnimationFrame(() => {
      hideLoading();
    });
  });

  document.getElementById('planPriorityFilter')?.addEventListener('change', (e) => {
    appState.setFilters({ planPriority: e.target.value });
  });

  document.getElementById('planStatusFilter')?.addEventListener('change', (e) => {
    appState.setFilters({ planStatus: e.target.value });
  });

  document.getElementById('planSortSelect')?.addEventListener('change', (e) => {
    appState.setFilters({ planSort: e.target.value });
  });

  document.getElementById('searchInput')?.addEventListener('input', (e) => {
    appState.setFilters({ search: e.target.value });
  });

  document.getElementById('priorityFilter')?.addEventListener('change', (e) => {
    appState.setFilters({ priority: e.target.value });
  });

  document.getElementById('statusFilter')?.addEventListener('change', (e) => {
    appState.setFilters({ status: e.target.value });
  });

  document.getElementById('sortSelect')?.addEventListener('change', (e) => {
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
  document.getElementById('colAddPlanBtn')?.addEventListener('click', openCreatePlanModal);

  document.getElementById('planColBody')?.addEventListener('click', async (e) => {
    try {
      // Empty state new plan button click
      const emptyBtn = e.target.closest('#emptyStateNewPlanBtn');
      if (emptyBtn) {
        openCreatePlanModal();
        return;
      }

      // Empty state load seed data button click
      const loadSeedBtn = e.target.closest('#emptyStateLoadSeedBtn');
      if (loadSeedBtn) {
        try {
          await API.populateSyntheticSeed();
          await appState.refreshData();
          const state = appState.getState();
          if (state.plans.length > 0) {
            appState.setSelectedPlan(state.plans[0].id);
          }
          showToast(i18n.t('loadExampleSuccess'), 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
        return;
      }

      // Pagination button clicks
      const pageBtn = e.target.closest('.plan-page-btn');
      if (pageBtn && !pageBtn.disabled) {
        const targetPage = parseInt(pageBtn.dataset.page, 10);
        if (targetPage && !isNaN(targetPage)) {
          appState.setPlanPage(targetPage);
        }
        return;
      }

      const planCard = e.target.closest('.plan-card');
      if (!planCard) return;

      const planId = planCard.dataset.planId;
      const actionBtn = e.target.closest('button');

      // If clicking action buttons inside the card
      if (actionBtn) {
        e.stopPropagation();
        if (planId) {
          appState.setSelectedPlan(planId);
        }
        if (actionBtn.classList.contains('plan-history-btn')) {
          openPlanHistoryModal(planId);
        } else if (actionBtn.classList.contains('edit-plan-btn')) {
          openEditPlanModal(planId, actionBtn);
        } else if (actionBtn.classList.contains('delete-plan-btn')) {
          if (confirm(i18n.getLang() === 'ko' ? '이 계획과 연결된 모든 할 일을 삭제하시겠습니까?' : 'Delete this plan and all associated To Dos?')) {
            try {
              // 1. Determine index of deleted plan in visible list before deletion
              const currentList = appState.getFilteredPlans();
              const deletedIndex = currentList.findIndex(p => String(p.id) === String(planId));

              await API.deletePlan(planId);
              await appState.refreshData();

              // 2. Determine target adjacent plan to preserve selection and focus
              const remainingList = appState.getFilteredPlans();
              let targetPlanId = null;

              if (remainingList.length > 0) {
                if (deletedIndex >= 0 && deletedIndex < remainingList.length) {
                  // Next sibling at the same index
                  targetPlanId = remainingList[deletedIndex].id;
                } else if (deletedIndex >= remainingList.length) {
                  // Deleted item was last -> previous item (index - 1)
                  targetPlanId = remainingList[remainingList.length - 1].id;
                } else {
                  targetPlanId = remainingList[0].id;
                }
              }

              // 3. Update active plan selection state
              appState.setSelectedPlan(targetPlanId);

              // 4. Focus target element and ensure active styling
              if (targetPlanId) {
                requestAnimationFrame(() => {
                  const newCard = document.querySelector(`.plan-card[data-plan-id="${targetPlanId}"]`);
                  if (newCard) {
                    if (!newCard.hasAttribute('tabindex')) {
                      newCard.setAttribute('tabindex', '0');
                    }
                    newCard.focus();
                  }
                });
              }

              showToast(i18n.t('planDeleted'), 'info');
            } catch (err) {
              showToast(err.message, 'error');
            }
          }
        }
        return;
      }

      // Direct card click selects the plan
      if (planId) {
        appState.setSelectedPlan(planId);
      }
    } catch (err) {
      console.warn('planColBody click handler error:', err);
    }
  });

  // Do Column Actions & Multi-Tag Filtering
  document.getElementById('colAddTodoBtn')?.addEventListener('click', openCreateTodoModal);

  document.getElementById('doColBody')?.addEventListener('click', async (e) => {
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

    // Delete individual execution log
    const deleteLogBtn = e.target.closest('.delete-log-btn');
    if (deleteLogBtn) {
      const logId = deleteLogBtn.dataset.logId;
      if (confirm(i18n.getLang() === 'ko' ? '이 실행 기록을 삭제하시겠습니까?' : 'Delete this execution log?')) {
        try {
          await API.deleteDoLog(logId);
          await appState.refreshData();
          showToast(i18n.getLang() === 'ko' ? '기록이 삭제되었습니다.' : 'Log deleted successfully.', 'info');
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
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

  // Double-click execution log to edit record
  document.getElementById('doColBody')?.addEventListener('dblclick', (e) => {
    const logItem = e.target.closest('.todo-log-item');
    if (logItem && !e.target.closest('.delete-log-btn')) {
      const logId = logItem.dataset.logId;
      const todoId = logItem.dataset.todoId;
      if (todoId && logId) {
        openExecLoggerModal(todoId, logId);
      }
    }
  });

  // See Column Actions
  document.getElementById('colReflectBtn')?.addEventListener('click', openSeeReviewModal);

  document.getElementById('seeColBody')?.addEventListener('click', (e) => {
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
      const input = document.getElementById('planPriorityInput');
      if (input) input.value = btn.dataset.priority;
    });
  });

  document.querySelectorAll('#todoPriorityPills .priority-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#todoPriorityPills .priority-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const input = document.getElementById('todoPriorityInput');
      if (input) input.value = btn.dataset.priority;
    });
  });
}

function setPriorityPill(containerId, hiddenInputId, priority) {
  const p = priority || 'medium';
  const hiddenInput = document.getElementById(hiddenInputId);
  if (hiddenInput) hiddenInput.value = p;
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
    if (planStart && planEnd && planStart.value && planEnd.value && planEnd.value < planStart.value) {
      showToast(i18n.t('dateRangeError'), 'warning');
      planEnd.classList.add('input-invalid');
    } else if (planEnd) {
      planEnd.classList.remove('input-invalid');
    }
  };
  planStart?.addEventListener('change', checkPlanDates);
  planEnd?.addEventListener('change', checkPlanDates);

  // Exec Start/End DateTime validation
  const execStart = document.getElementById('execStartInput');
  const execEnd = document.getElementById('execEndInput');
  const checkExecTimes = () => {
    if (execStart && execEnd && execStart.value && execEnd.value) {
      const s = new Date(execStart.value).getTime();
      const en = new Date(execEnd.value).getTime();
      if (en >= s) {
        const diffMins = Math.max(1, Math.round((en - s) / 60000));
        const minEl = document.getElementById('execMinutesInput');
        if (minEl) minEl.value = diffMins;
      }
    }
  };
  execStart?.addEventListener('change', checkExecTimes);
  execEnd?.addEventListener('change', checkExecTimes);
}

// --- MODALS & FORMS ---
function bindModalForms() {
  // Prevent unintended Enter submissions inside single-line inputs across all modal forms
  ['planForm', 'todoForm', 'execForm', 'seeForm'].forEach(formId => {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener('keydown', (e) => {
      try {
        if (e.key === 'Enter') {
          const isModifier = e.ctrlKey || e.metaKey;
          const targetTag = e.target?.tagName?.toLowerCase();
          const isSearch = e.target?.type === 'search' || (e.target?.id && e.target.id.toLowerCase().includes('search'));
          if (targetTag === 'input' && !isModifier && !isSearch) {
            e.preventDefault();
          }
        }
      } catch (err) {}
    });
  });

  // Plan Modal
  let isSubmittingPlan = false;
  document.getElementById('planModalCloseBtn')?.addEventListener('click', () => modalManager.attemptClose('planModal'));
  document.getElementById('planModalCancelBtn')?.addEventListener('click', () => modalManager.attemptClose('planModal'));
  document.getElementById('planForm')?.addEventListener('submit', async (e) => {
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

    const titleVal = document.getElementById('planTitleInput').value.trim();
    if (!titleVal) {
      showToast(i18n.t('enterPlanTitle'), 'error');
      document.getElementById('planTitleInput').focus();
      unlock();
      return;
    }
    if (titleVal.length > 100) {
      showToast(i18n.t('textTooLong').replace('{max}', 100), 'error');
      document.getElementById('planTitleInput').focus();
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

    const criteriaVal = document.getElementById('planCriteriaInput').value.trim();
    if (criteriaVal.length > 500) {
      showToast(i18n.t('textTooLong').replace('{max}', 500), 'error');
      document.getElementById('planCriteriaInput').focus();
      unlock();
      return;
    }

    const existingPlan = isEdit ? appState.getState().plans.find(p => p.id === id) : null;
    const planTodos = isEdit ? appState.getState().todos.filter(t => String(t.plan_id) === String(id)) : [];
    const allDosCompleted = planTodos.length > 0 && planTodos.every(t => t.is_completed || t.status === 'completed');

    // Automatically derive status based on task completion (not manually chosen)
    let autoStatus = 'active';
    if (isEdit && existingPlan) {
      autoStatus = allDosCompleted ? 'completed' : (existingPlan.status === 'completed' ? 'active' : (existingPlan.status || 'active'));
    }

    const sourceInput = document.getElementById('planSourcePlanIdInput');
    const sourcePlanId = sourceInput ? sourceInput.value : '';

    const payload = {
      title: titleVal,
      period_start: startVal,
      period_end: endVal,
      priority: document.getElementById('planPriorityInput').value,
      estimated_hours: estimatedMinutes,
      success_criteria: criteriaVal,
      status: autoStatus
    };
    if (!isEdit && sourcePlanId) {
      payload.source_plan_id = sourcePlanId;
    }

    if (isEdit) {
      // Offline check before saving plan edits
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        showToast(i18n.getLang() === 'ko' ? '네트워크 오류: 인터넷 연결을 확인해 주세요.' : 'Network error: Please check your internet connection.', 'error');
        unlock();
        return;
      }

      const revisionReasonInput = document.getElementById('planRevisionReasonInput') || document.querySelector('#edit-plan-reason');
      const revisionReason = revisionReasonInput ? revisionReasonInput.value.trim() : '';
      if (revisionReason.length > 255) {
        showToast(i18n.t('textTooLong').replace('{max}', 255), 'error');
        if (revisionReasonInput) revisionReasonInput.focus();
        unlock();
        return;
      }

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
        showToast(i18n.getLang() === 'ko' ? '수정된 내용이 없습니다.' : (i18n.t('noChangesMade') || '수정된 내용이 없습니다.'), 'warning');
        unlock();
        return;
      }

      payload.revision_reason = revisionReason || 'Revision before update';
    }

    try {
      if (isEdit) {
        await API.updatePlan(id, payload);
        modalManager.forceClose('planModal');
        await appState.refreshData();
        showToast(i18n.t('planUpdated'), 'success');
      } else {
        const createdPlan = await API.createPlan(payload);

        const repGroup = document.getElementById('planReplicateTodosGroup');
        const repCheck = document.getElementById('planReplicateTodosCheckbox');
        const isReplicateActive = repGroup && repGroup.style.display !== 'none' && repCheck && repCheck.checked;

        if (sourcePlanId) {
          // Explicitly update source plan status to completed upon generating feedback plan
          await API.updatePlan(sourcePlanId, {
            status: 'completed',
            revision_reason: 'Completed and advanced to feedback improvement plan'
          }).catch(() => {});
        }

        if (isReplicateActive && sourcePlanId) {
          const sourceTodos = appState.getState().todos.filter(t => String(t.plan_id) === String(sourcePlanId));
          const totalTodosMin = sourceTodos.reduce((sum, st) => sum + (Number(st.estimated_minutes) || 0), 0);
          if (totalTodosMin > (Number(createdPlan.estimated_hours) || 0)) {
            await API.updatePlan(createdPlan.id, {
              estimated_hours: totalTodosMin,
              revision_reason: 'Budget expanded for replicated tasks'
            }).catch(() => {});
          }

          for (const st of sourceTodos) {
            try {
              let targetDueDate = st.due_date;
              if (createdPlan.period_end && (!targetDueDate || targetDueDate > createdPlan.period_end || targetDueDate < createdPlan.period_start)) {
                targetDueDate = createdPlan.period_end;
              }
              await API.createTodo({
                plan_id: createdPlan.id,
                title: st.title,
                due_date: targetDueDate || getKSTToday(),
                priority: st.priority || 'medium',
                estimated_minutes: st.estimated_minutes,
                tags: Array.isArray(st.tags) ? st.tags : [],
                description: st.description || ''
              });
            } catch (err) {
              console.warn('Replicating todo failed:', err.message);
            }
          }
        }

        modalManager.forceClose('planModal');
        appState.setFilters({ search: '' });
        await appState.refreshData();
        appState.setSelectedPlan(createdPlan.id);
        
        if (isReplicateActive && sourcePlanId) {
          showToast(i18n.t('feedbackPlanCreatedWithTodos'), 'success');
        } else {
          showToast(i18n.t('planSaved'), 'success');
        }
      }
    } catch (err) {
      const isNetworkErr = (typeof navigator !== 'undefined' && !navigator.onLine) ||
        err?.name === 'TypeError' ||
        (err?.message && (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('offline') || err.message.includes('Failed to fetch')));
      if (isNetworkErr) {
        showToast(i18n.getLang() === 'ko' ? '네트워크 오류: 인터넷 연결을 확인해 주세요.' : 'Network error: Please check your internet connection.', 'error');
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      unlock();
    }
  });

  // To Do Modal
  document.getElementById('todoModalCloseBtn')?.addEventListener('click', () => modalManager.attemptClose('todoModal'));
  document.getElementById('todoModalCancelBtn')?.addEventListener('click', () => modalManager.attemptClose('todoModal'));

  document.getElementById('todoPlanSelect')?.addEventListener('change', (e) => {
    const selectedPlan = appState.getState().plans.find(p => p.id === e.target.value);
    if (selectedPlan && selectedPlan.period_end) {
      const dueDateEl = document.getElementById('todoDueDateInput');
      if (dueDateEl) {
        dueDateEl.max = selectedPlan.period_end;
        if (dueDateEl.value > selectedPlan.period_end) {
          dueDateEl.value = selectedPlan.period_end;
          const msg = i18n.t('todoDueDateExceedsPlan').replace('{date}', selectedPlan.period_end);
          showToast(msg, 'warning', 4500);
        }
      }
    }
  });

  document.getElementById('todoEstimatedMinutesInput')?.addEventListener('input', (e) => {
    const planId = document.getElementById('todoPlanSelect')?.value;
    const selectedPlan = appState.getState().plans.find(p => String(p.id) === String(planId));
    const id = document.getElementById('todoFormId')?.value;
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
  document.getElementById('todoForm')?.addEventListener('submit', async (e) => {
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
    if (tagsRaw.length > 150) {
      showToast(i18n.t('textTooLong').replace('{max}', 150), 'error');
      document.getElementById('todoTagsInput').focus();
      unlock();
      return;
    }
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

    const todoTitle = document.getElementById('todoTitleInput').value.trim();
    if (!todoTitle) {
      showToast(i18n.t('enterTodoTitle'), 'error');
      document.getElementById('todoTitleInput').focus();
      unlock();
      return;
    }
    if (todoTitle.length > 100) {
      showToast(i18n.t('textTooLong').replace('{max}', 100), 'error');
      document.getElementById('todoTitleInput').focus();
      unlock();
      return;
    }

    const descVal = document.getElementById('todoDescInput').value.trim();
    if (descVal.length > 1000) {
      showToast(i18n.t('textTooLong').replace('{max}', 1000), 'error');
      document.getElementById('todoDescInput').focus();
      unlock();
      return;
    }

    const payload = {
      plan_id: planId,
      title: todoTitle,
      due_date: dueDate,
      priority: document.getElementById('todoPriorityInput').value,
      estimated_minutes: estimatedMinutes,
      tags: tags,
      description: descVal
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

  // Do Execution Logger
  document.getElementById('execModalCloseBtn')?.addEventListener('click', () => { stopTimer(); modalManager.attemptClose('execModal'); });
  document.getElementById('execModalCancelBtn')?.addEventListener('click', () => { stopTimer(); modalManager.attemptClose('execModal'); });

  const recalcExecDuration = () => {
    const startVal = document.getElementById('execStartInput')?.value;
    const endVal = document.getElementById('execEndInput')?.value;
    if (startVal && endVal) {
      const diffMs = new Date(endVal).getTime() - new Date(startVal).getTime();
      if (diffMs >= 0) {
        const minInput = document.getElementById('execMinutesInput');
        if (minInput) minInput.value = Math.round(diffMs / 60000);
      }
    }
  };
  document.getElementById('execStartInput')?.addEventListener('change', recalcExecDuration);
  document.getElementById('execEndInput')?.addEventListener('change', recalcExecDuration);
  document.getElementById('execMinutesInput')?.addEventListener('blur', () => {
    const startTimeVal = document.getElementById('execStartInput')?.value;
    const durationMins = parseInt(document.getElementById('execMinutesInput')?.value, 10);
    if (startTimeVal && !isNaN(durationMins) && durationMins >= 0) {
      const startDate = new Date(startTimeVal);
      const endDate = new Date(startDate.getTime() + durationMins * 60000);
      const tzOffset = endDate.getTimezoneOffset() * 60000;
      const localISOTime = new Date(endDate.getTime() - tzOffset).toISOString().slice(0, 16);
      const endInput = document.getElementById('execEndInput');
      if (endInput) endInput.value = localISOTime;
    }
  });

  document.getElementById('execTimerStartBtn')?.addEventListener('click', startTimer);
  document.getElementById('execTimerStopBtn')?.addEventListener('click', stopTimer);
  document.getElementById('execTimerResetBtn')?.addEventListener('click', resetTimer);

  let isSubmittingExec = false;
  const handleSaveLogOnly = async () => {
    if (isSubmittingExec) return;
    isSubmittingExec = true;

    const saveOnlyBtn = document.getElementById('execSaveLogOnlyBtn');
    if (saveOnlyBtn) { saveOnlyBtn.disabled = true; saveOnlyBtn.style.pointerEvents = 'none'; }
    const unlock = () => { setTimeout(() => { isSubmittingExec = false; if (saveOnlyBtn) { saveOnlyBtn.disabled = false; saveOnlyBtn.style.pointerEvents = ''; } }, 600); };

    const todoId = document.getElementById('execTodoId').value;
    const logId = document.getElementById('execLogId')?.value;
    const startVal = document.getElementById('execStartInput').value;
    const endVal = document.getElementById('execEndInput').value;
    if (startVal && endVal && new Date(endVal).getTime() < new Date(startVal).getTime()) {
      showToast(i18n.t('timeRangeError'), 'error');
      unlock();
      return;
    }
    
    const actualMin = parseInt(document.getElementById('execMinutesInput').value, 10) || 0;
    const startTime = startVal ? new Date(startVal).toISOString() : new Date().toISOString();
    const endTime = endVal ? new Date(endVal).toISOString() : new Date().toISOString();
    const blockedReason = document.getElementById('execBlockerInput').value.trim();
    const memoVal = document.getElementById('execMemoInput')?.value?.trim() || '';

    try {
      if (logId) {
        await API.updateDoLog(logId, { execution_start: startTime, execution_end: endTime, actual_minutes: actualMin, blocked_reason: blockedReason, memo: memoVal });
        showToast(i18n.getLang() === 'ko' ? '기록이 수정되었습니다.' : 'Log updated successfully.', 'success');
      } else {
        await API.addDoLog(todoId, { execution_start: startTime, execution_end: endTime, actual_minutes: actualMin, blocked_reason: blockedReason, memo: memoVal });
        showToast(i18n.t('logSaved'), 'success');
      }
      stopTimer();
      modalManager.forceClose('execModal');
      await appState.refreshData();
    } catch (err) { showToast(err.message, 'error'); } finally { unlock(); }
  };
  document.getElementById('execSaveLogOnlyBtn')?.addEventListener('click', (e) => { e.preventDefault(); handleSaveLogOnly(); });

  document.getElementById('execForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingExec) return;
    isSubmittingExec = true;
    const submitBtn = document.getElementById('execCompleteAndLogBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.style.pointerEvents = 'none'; }
    const unlock = () => { setTimeout(() => { isSubmittingExec = false; if (submitBtn) { submitBtn.disabled = false; submitBtn.style.pointerEvents = ''; } }, 600); };

    const todoId = document.getElementById('execTodoId').value;
    const logId = document.getElementById('execLogId')?.value;
    const startVal = document.getElementById('execStartInput').value;
    const endVal = document.getElementById('execEndInput').value;
    if (startVal && endVal && new Date(endVal).getTime() < new Date(startVal).getTime()) {
      showToast(i18n.t('timeRangeError'), 'error');
      unlock();
      return;
    }
    
    const actualMin = parseInt(document.getElementById('execMinutesInput').value, 10) || 0;
    if (actualMin <= 0) { showToast(i18n.t('minDurationRequired'), 'error'); unlock(); return; }

    const completionToken = crypto.randomUUID();
    const startTime = startVal ? new Date(startVal).toISOString() : new Date().toISOString();
    const endTime = endVal ? new Date(endVal).toISOString() : new Date().toISOString();
    const blockedReason = document.getElementById('execBlockerInput').value.trim();
    const memoVal = document.getElementById('execMemoInput')?.value?.trim() || '';

    try {
      if (logId) {
        await API.updateDoLog(logId, { execution_start: startTime, execution_end: endTime, actual_minutes: actualMin, blocked_reason: blockedReason, memo: memoVal });
        showToast(i18n.getLang() === 'ko' ? '기록이 수정되었습니다.' : 'Log updated successfully.', 'success');
      } else {
        await API.completeTodoIdempotent(todoId, { execution_start: startTime, execution_end: endTime, actual_minutes: actualMin, blocked_reason: blockedReason, memo: memoVal }, completionToken);
        showToast(i18n.t('taskCompletedAndLogSaved'), 'success');
      }
      stopTimer();
      modalManager.forceClose('execModal');
      await appState.refreshData();
    } catch (err) { showToast(err.message, 'error'); } finally { unlock(); }
  });

  // History Modal
  document.getElementById('historyModalCloseBtn')?.addEventListener('click', () => modalManager.forceClose('historyModal'));
  document.getElementById('historyModalDismissBtn')?.addEventListener('click', () => modalManager.forceClose('historyModal'));

  // See Review Modal
  let isSubmittingSee = false;
  document.getElementById('seeModalCloseBtn')?.addEventListener('click', () => modalManager.attemptClose('seeModal'));
  document.getElementById('seeModalCancelBtn')?.addEventListener('click', () => modalManager.attemptClose('seeModal'));
  document.getElementById('seeForm')?.addEventListener('submit', async (e) => {
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
    if (!insight) {
      showToast(i18n.t('enterInsight'), 'error');
      document.getElementById('seeInsightInput').focus();
      unlock();
      return;
    }
    if (insight.length > 1000) {
      showToast(i18n.t('textTooLong').replace('{max}', 1000), 'error');
      document.getElementById('seeInsightInput').focus();
      unlock();
      return;
    }

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
  document.getElementById('resetModalCloseBtn')?.addEventListener('click', () => modalManager.forceClose('resetModal'));
  document.getElementById('resetModalCancelBtn')?.addEventListener('click', () => modalManager.forceClose('resetModal'));
  document.getElementById('resetModalConfirmBtn')?.addEventListener('click', async () => {
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
      await API.purgeUserData();
      modalManager.forceClose('resetModal');
      await appState.refreshData();
      appState.setSelectedPlan(null);
      showToast(i18n.t('resetSuccess'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      unlock();
    }
  });

  // Reset Modal: Populate Synthetic Seed (Generate Examples)
  let isSubmittingSeed = false;
  document.getElementById('resetModalSeedBtn')?.addEventListener('click', async () => {
    if (isSubmittingSeed) return;
    isSubmittingSeed = true;

    try {
      await API.populateSyntheticSeed();
      modalManager.forceClose('resetModal');
      await appState.refreshData();
      const state = appState.getState();
      if (state.plans.length > 0) {
        appState.setSelectedPlan(state.plans[0].id);
      }
      showToast(i18n.t('loadExampleSuccess'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      isSubmittingSeed = false;
    }
  });

  // Import JSON Modal
  let isSubmittingImport = false;
  document.getElementById('importModalCloseBtn')?.addEventListener('click', () => modalManager.forceClose('importModal'));
  document.getElementById('importModalCancelBtn')?.addEventListener('click', () => modalManager.forceClose('importModal'));
  document.getElementById('importModalSubmitBtn')?.addEventListener('click', async () => {
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
        const state = appState.getState();
        if (state.plans.length > 0) {
          appState.setSelectedPlan(state.plans[0].id);
        } else {
          appState.setSelectedPlan(null);
        }
        showToast(i18n.t('backupImported'), 'success');
      } catch (err) {
        showToast(i18n.getLang() === 'ko' ? `가져오기 오류: ${err.message}` : `Import Error: ${err.message}`, 'error', 6000);
      } finally {
        unlock();
      }
    };

    reader.onerror = () => {
      showToast(i18n.getLang() === 'ko' ? '파일을 읽는데 실패했습니다.' : 'Failed to read file from disk.', 'error');
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
  const statusInput = document.getElementById('planStatusInput');
  if (statusInput) statusInput.value = 'active';
  document.getElementById('planRevisionReasonGroup').style.display = 'none';
  document.getElementById('planRevisionReasonInput').value = '';
  const repGroup = document.getElementById('planReplicateTodosGroup');
  if (repGroup) repGroup.style.display = 'none';
  const sourceInput = document.getElementById('planSourcePlanIdInput');
  if (sourceInput) sourceInput.value = '';
  modalManager.open('planModal');
}

function openEditPlanModal(planId, triggerEl = null) {
  if (planId) {
    appState.setSelectedPlan(planId);
  }
  const plan = appState.getState().plans.find(p => p.id === planId);
  if (!plan) return;

  const opener = triggerEl || (typeof document !== 'undefined' ? document.querySelector(`.plan-card[data-plan-id="${planId}"] .edit-plan-btn`) : null) || (typeof document !== 'undefined' ? document.activeElement : null);

  document.getElementById('planModalTitle').textContent = i18n.t('editPlanTitle');
  document.getElementById('planFormId').value = plan.id;
  document.getElementById('planTitleInput').value = plan.title;
  document.getElementById('planStartInput').value = plan.period_start;
  document.getElementById('planEndInput').value = plan.period_end;
  setPriorityPill('planPriorityPills', 'planPriorityInput', plan.priority || 'medium');
  document.getElementById('planHoursInput').value = plan.estimated_hours;
  document.getElementById('planCriteriaInput').value = plan.success_criteria || '';
  const statusInput = document.getElementById('planStatusInput');
  if (statusInput) statusInput.value = plan.status || 'active';
  document.getElementById('planRevisionReasonGroup').style.display = 'block';
  document.getElementById('planRevisionReasonInput').value = '';
  const repGroup = document.getElementById('planReplicateTodosGroup');
  if (repGroup) repGroup.style.display = 'none';
  const sourceInput = document.getElementById('planSourcePlanIdInput');
  if (sourceInput) sourceInput.value = '';
  modalManager.open('planModal', opener);
}

function openPlanHistoryModal(planId) {
  if (planId) {
    appState.setSelectedPlan(planId);
  }
  const state = appState.getState();
  const plan = state.plans.find(p => String(p.id) === String(planId));
  const histories = state.plan_histories.filter(h => String(h.plan_id) === String(planId));
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
  const todo = (state.todos || []).find(t => t.id === todoId);
  if (!todo) return;

  const select = document.getElementById('todoPlanSelect');
  select.innerHTML = (state.plans || []).map(p => `
    <option value="${p.id}" ${p.id === todo.plan_id ? 'selected' : ''}>${escapeHtml(p.title)}</option>
  `).join('');

  const targetPlan = (state.plans || []).find(p => p.id === todo.plan_id);
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

function openExecLoggerModal(todoId, logId = null) {
  const todo = (appState.getState().todos || []).find(t => t.id === todoId);
  if (!todo) return;

  const logs = (appState.getState().do_logs || []).filter(l => String(l.todo_id) === String(todo.id));
  const existingActualMinutes = logs.reduce((sum, l) => sum + (Number(l.actual_minutes) || 0), 0);

  document.getElementById('execTodoId').value = todo.id;
  const execLogIdEl = document.getElementById('execLogId');
  if (execLogIdEl) execLogIdEl.value = logId || '';
  
  const summaryText = existingActualMinutes > 0
    ? `${todo.title} (${i18n.t('estimatedLabel')} ${todo.estimated_minutes || 0}${i18n.t('minutesUnit')} | ${i18n.t('actualLabel')} ${existingActualMinutes}${i18n.t('minutesUnit')})`
    : `${todo.title} (${i18n.t('estimatedLabel')} ${todo.estimated_minutes || 0}${i18n.t('minutesUnit')})`;
  document.getElementById('execTodoSummary').textContent = summaryText;
  
  const now = new Date();
  const toLocalInput = (d) => {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  timerState.baseMinutes = 0;

  // Strict lookup for targetLog: explicitly find by logId, NEVER fallback to logs[0] or logs[logs.length - 1]
  const targetLog = logId ? logs.find(log => String(log.id) === String(logId)) : null;
  const saveOnlyBtn = document.getElementById('execSaveLogOnlyBtn');
  const submitBtn = document.getElementById('execCompleteAndLogBtn');
  const timerSection = document.getElementById('execTimerSection');

  if (targetLog) {
    document.getElementById('execModalTitle').textContent = i18n.getLang() === 'ko' ? '실행 기록 수정' : 'Edit Execution Log';
    if (saveOnlyBtn) saveOnlyBtn.style.display = 'none';
    if (submitBtn) submitBtn.textContent = i18n.getLang() === 'ko' ? '저장' : 'Save';
    if (timerSection) timerSection.style.display = 'none';

    const sDate = targetLog.execution_start ? new Date(targetLog.execution_start) : now;
    const eDate = targetLog.execution_end ? new Date(targetLog.execution_end) : now;
    document.getElementById('execStartInput').value = toLocalInput(sDate);
    document.getElementById('execEndInput').value = toLocalInput(eDate);
    document.getElementById('execMinutesInput').value = targetLog.actual_minutes || 0;
    const cleanBlocker = targetLog.blocked_reason && !targetLog.blocked_reason.startsWith('enc:v1:') ? targetLog.blocked_reason : '';
    const cleanMemo = targetLog.memo && !targetLog.memo.startsWith('enc:v1:') ? targetLog.memo : '';
    document.getElementById('execBlockerInput').value = cleanBlocker;
    const memoInput = document.getElementById('execMemoInput');
    if (memoInput) memoInput.value = cleanMemo;
  } else {
    document.getElementById('execModalTitle').textContent = i18n.getLang() === 'ko' ? 'Do 실행 기록' : 'Log Execution Time';
    if (saveOnlyBtn) saveOnlyBtn.style.display = '';
    if (submitBtn) submitBtn.textContent = i18n.getLang() === 'ko' ? '완료 처리 및 기록 저장' : 'Complete & Save Log';
    if (timerSection) timerSection.style.display = '';

    document.getElementById('execStartInput').value = toLocalInput(now);
    document.getElementById('execEndInput').value = toLocalInput(now);
    document.getElementById('execMinutesInput').value = 0;
    document.getElementById('execBlockerInput').value = '';
    const memoInput = document.getElementById('execMemoInput');
    if (memoInput) memoInput.value = '';
  }

  resetTimer();
  modalManager.open('execModal');
}

function openSeeReviewModal() {
  const state = appState.getState();
  const planId = state.selectedPlanId;
  if (!planId) {
    showToast(i18n.t('selectPlanFirst'), 'warning');
    return;
  }
  const planTodos = (state.todos || []).filter(t => String(t.plan_id) === String(planId));
  if (planTodos.length === 0) {
    showToast(i18n.getLang() === 'ko' ? '해당 계획에 등록된 할 일(Do)이 없어 회고를 작성할 수 없습니다.' : 'Cannot write retrospective: No Do entries exist for this plan.', 'warning');
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

  document.getElementById('planModalTitle').textContent = i18n.getLang() === 'ko' ? '피드백 개선 계획' : 'Advance Feedback Plan';
  document.getElementById('planFormId').value = '';
  
  // Title with [RE] prefix
  const originalTitle = currentPlan ? currentPlan.title : 'New Plan';
  document.getElementById('planTitleInput').value = originalTitle.startsWith('[RE]') ? originalTitle : `[RE] ${originalTitle}`;
  
  document.getElementById('planStartInput').value = getKSTToday();
  document.getElementById('planEndInput').value = getKSTToday();
  setPriorityPill('planPriorityPills', 'planPriorityInput', currentPlan ? currentPlan.priority : 'high');
  
  const sourceTodos = currentPlan ? state.todos.filter(t => String(t.plan_id) === String(currentPlan.id)) : [];
  const totalTodosMin = sourceTodos.reduce((sum, t) => sum + (Number(t.estimated_minutes) || 0), 0);
  const previousPlanMin = currentPlan ? (Number(currentPlan.estimated_hours) || 60) : 60;
  const adjustedMin = Math.max(totalTodosMin, metrics.totalActualMin || 0, previousPlanMin);
  document.getElementById('planHoursInput').value = adjustedMin;

  const autoInsight = `${i18n.getLang() === 'ko' ? '이전 주기 피드백 기반 자동 조정' : 'Adjusted based on previous cycle'} (${i18n.t('metricPlanned')}: ${metrics.plannedCount}, ${i18n.t('metricCompleted')}: ${metrics.completedCount}, ${i18n.t('metricDelayed')}: ${metrics.delayedCount}, ${i18n.t('metricTimeDelta')}: ${metrics.timeDeltaMinutes}${i18n.t('minutesUnit')})`;
  document.getElementById('planCriteriaInput').value = autoInsight;
  document.getElementById('planRevisionReasonGroup').style.display = 'none';

  const repGroup = document.getElementById('planReplicateTodosGroup');
  if (repGroup) repGroup.style.display = 'block';
  const repCheck = document.getElementById('planReplicateTodosCheckbox');
  if (repCheck) repCheck.checked = true;
  const sourceInput = document.getElementById('planSourcePlanIdInput');
  if (sourceInput) sourceInput.value = currentPlan ? currentPlan.id : '';

  modalManager.open('planModal');
}

// --- BACKGROUND DRIFT-CORRECTED TIMER ---
function startTimer() {
  if (timerState.isRunning) return;
  timerState.isRunning = true;
  
  const currentInputMins = parseInt(document.getElementById('execMinutesInput').value, 10);
  if (!isNaN(currentInputMins) && currentInputMins >= 0) {
    timerState.baseMinutes = currentInputMins;
  }
  
  timerState.startEpoch = Date.now() - (timerState.elapsedSeconds * 1000);
  
  const startBtn = document.getElementById('execTimerStartBtn');
  const stopBtn = document.getElementById('execTimerStopBtn');
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;

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
  const startBtn = document.getElementById('execTimerStartBtn');
  const stopBtn = document.getElementById('execTimerStopBtn');
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;

  const measuredMins = Math.max(1, Math.round(timerState.elapsedSeconds / 60));
  const baseMins = Number(timerState.baseMinutes) || 0;
  
  // 기존 소요 시간에 타이머 측정 시간을 누적
  const totalMins = baseMins + measuredMins;
  const minEl = document.getElementById('execMinutesInput');
  if (minEl) minEl.value = totalMins;

  // 종료 시간 및 시작 시간도 누적 시간에 맞춰 자동 갱신
  const now = new Date();
  const startTime = new Date(now.getTime() - (totalMins * 60000));
  const toLocalInput = (d) => {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const startInput = document.getElementById('execStartInput');
  const endInput = document.getElementById('execEndInput');
  if (startInput) startInput.value = toLocalInput(startTime);
  if (endInput) endInput.value = toLocalInput(now);
}

function resetTimer() {
  if (timerState.isRunning) {
    timerState.isRunning = false;
    clearInterval(timerState.intervalId);
    const startBtn = document.getElementById('execTimerStartBtn');
    const stopBtn = document.getElementById('execTimerStopBtn');
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
  }
  timerState.elapsedSeconds = 0;
  updateTimerDisplay();
  const baseMins = Number(timerState.baseMinutes) || 0;
  if (baseMins > 0) {
    const minEl = document.getElementById('execMinutesInput');
    if (minEl) minEl.value = baseMins;
  }
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
    try {
      // Ctrl / Cmd + Enter to submit active modal
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (modalManager.activeModal) {
          const submitBtn = modalManager.activeModal.querySelector('button[type="submit"], #deleteAccountConfirmBtn');
          if (submitBtn && !submitBtn.disabled) {
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
    } catch (err) {}
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
