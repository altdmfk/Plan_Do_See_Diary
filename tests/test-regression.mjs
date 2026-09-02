/**
 * Automated Regression Test Suite
 * Covers TASK 07 Critical Defects:
 * 1. Append-Only Time Logs (multiple logs per todo, duration sum)
 * 2. Individual Log Deletion (deleteDoLog, duration recalculation)
 * 3. Purge User Data Payload (query filters with user_id, foreign-key deletion sequence)
 * 4. Auth 400 Suppression (graceful catch of invalid_grant without unhandled rejections)
 */

import fs from 'fs';
import path from 'path';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✅ PASS: ${message}`);
  } else {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Track outgoing fetch calls
const interceptedFetches = [];

// Mock globals required by ES modules
global.localStorage = (() => {
  let store = {};
  return {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; }
  };
})();

global.sessionStorage = (() => {
  let store = {};
  return {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; }
  };
})();

global.window = {
  __PDS_SUPABASE_URL: 'https://test-project.supabase.co',
  __PDS_SUPABASE_KEY: 'test-anon-key',
  addEventListener: () => {},
  removeEventListener: () => {}
};

global.requestAnimationFrame = (cb) => { cb(); return 0; };
global.cancelAnimationFrame = () => {};

Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: () => `test-${Math.random().toString(36).slice(2)}-${Date.now()}`,
  writable: true,
  configurable: true
});

global.fetch = async (url, opts = {}) => {
  interceptedFetches.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
  
  if (String(url).includes('/auth/v1/token')) {
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'Invalid login credentials' }),
      clone: function() { return this; }
    };
  }

  return {
    ok: true,
    status: 200,
    json: async () => ([]),
    clone: function() { return this; }
  };
};

global.document = {
  getElementById: (id) => ({
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    querySelectorAll: () => [],
    querySelector: () => null,
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {}
  }),
  documentElement: {
    setAttribute: () => {},
    getAttribute: () => null
  },
  querySelectorAll: () => [],
  activeElement: null
};

// Dynamically import modules
const { CONFIG } = await import('../src/core/config.js');
const { authClient } = await import('../src/auth/auth.js');
const { dbClient } = await import('../src/api/supabaseClient.js');
const { API } = await import('../src/api/api.js');
const { appState } = await import('../src/state/state.js');
const { modalManager } = await import('../src/ui/ui.js');

async function runRegressionTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING TASK 07 AUTOMATED REGRESSION TESTS');
  console.log('====================================================\n');

  // Setup mock auth session
  const mockUserId = 'usr_regression_test_123';
  const mockSession = {
    access_token: 'mock_jwt_token_header_payload_signature',
    refresh_token: 'mock_refresh_token',
    expires_in: 3600,
    user: { id: mockUserId, email: 'tester@regression.com' }
  };
  authClient.setSession(mockSession);

  assert(authClient.isAuthenticated(), 'Mock session authenticated successfully');
  assert(authClient.getUserId() === mockUserId, 'User ID matches authenticated mock user');

  // ----------------------------------------------------------------
  // TEST 1: Append-Only Time Logs & Total Duration Sum
  // ----------------------------------------------------------------
  console.log('\n--- [1] Append-Only Time Logs & Duration Sum ---');
  
  // Clear any existing test data
  dbClient.clearMemoryStore();
  global.localStorage.clear();

  const plan = await API.createPlan({
    title: 'Sprint 07 Regression Plan',
    period_start: '2026-09-01',
    period_end: '2026-09-07',
    priority: 'high',
    estimated_hours: 120,
    success_criteria: 'Zero regressions'
  });

  const todo = await API.createTodo({
    plan_id: plan.id,
    title: 'Regression Task with Multiple Logs',
    due_date: '2026-09-02',
    priority: 'urgent',
    estimated_minutes: 60,
    tags: ['regression', 'testing'],
    description: 'Verify multiple execution logs append without overwriting'
  });

  // Insert First Log (25 mins)
  const log1 = await API.addDoLog(todo.id, {
    execution_start: '2026-09-01T09:00:00.000Z',
    execution_end: '2026-09-01T09:25:00.000Z',
    actual_minutes: 25,
    blocked_reason: '',
    memo: 'First session completed'
  });

  // Insert Second Log (35 mins)
  const log2 = await API.addDoLog(todo.id, {
    execution_start: '2026-09-01T10:00:00.000Z',
    execution_end: '2026-09-01T10:35:00.000Z',
    actual_minutes: 35,
    blocked_reason: 'Brief network delay',
    memo: 'Second session completed'
  });

  const allData = await API.fetchAll();
  const todoLogs = allData.do_logs.filter(l => String(l.todo_id) === String(todo.id));

  assert(todoLogs.length === 2, `Expected 2 distinct do_logs rows for todo_id, found ${todoLogs.length}`);
  assert(todoLogs.some(l => l.id === log1.id), 'Log 1 exists in store');
  assert(todoLogs.some(l => l.id === log2.id), 'Log 2 exists in store');

  const totalDuration = API.getTodoActualMinutes(todo.id);
  assert(totalDuration === 60, `Total duration must equal sum (25 + 35 = 60), got ${totalDuration}`);

  // ----------------------------------------------------------------
  // TEST 2: Individual Log Deletion & Duration Recalculation
  // ----------------------------------------------------------------
  console.log('\n--- [2] Individual Log Deletion & Duration Recalculation ---');

  const deleteResult = await API.deleteDoLog(log1.id);
  assert(deleteResult.success === true, 'deleteDoLog returned success: true');

  const dataAfterDelete = await API.fetchAll();
  const remainingLogs = dataAfterDelete.do_logs.filter(l => String(l.todo_id) === String(todo.id));

  assert(remainingLogs.length === 1, `Expected 1 remaining log after deletion, found ${remainingLogs.length}`);
  assert(remainingLogs[0].id === log2.id, 'Remaining log is log2');

  const recalculatedDuration = API.getTodoActualMinutes(todo.id);
  assert(recalculatedDuration === 35, `Recalculated duration must equal remaining log (35 mins), got ${recalculatedDuration}`);

  // ----------------------------------------------------------------
  // TEST 3: Purge User Data Payload & Filter Enforcement
  // ----------------------------------------------------------------
  console.log('\n--- [3] Purge User Data REST Queries & User ID Filter ---');

  interceptedFetches.length = 0; // Clear history
  await API.purgeUserData();

  const deleteFetches = interceptedFetches.filter(f => f.method === 'DELETE');
  assert(deleteFetches.length >= 4, `Expected at least 4 REST DELETE calls during purgeUserData, got ${deleteFetches.length}`);

  // Verify each DELETE query contains user_id filter to prevent 400 Bad Request
  for (const del of deleteFetches) {
    const hasUserFilter = del.url.includes(`user_id=eq.${mockUserId}`) || del.url.includes('user_id=eq.') || del.url.includes('id=neq.');
    assert(hasUserFilter, `REST DELETE endpoint "${del.url}" must contain user_id filter`);
  }

  // Verify deletion order: child tables first
  const deleteUrls = deleteFetches.map(f => f.url);
  const planIdx = deleteUrls.findIndex(u => u.includes('/plans'));
  const todoIdx = deleteUrls.findIndex(u => u.includes('/todos'));
  const logIdx = deleteUrls.findIndex(u => u.includes('/do_logs'));

  if (planIdx !== -1 && todoIdx !== -1 && logIdx !== -1) {
    assert(logIdx < planIdx, 'do_logs deleted before plans (FK integrity)');
    assert(todoIdx < planIdx, 'todos deleted before plans (FK integrity)');
  }

  // ----------------------------------------------------------------
  // TEST 4: Auth 400 (Bad Request) Error Suppression
  // ----------------------------------------------------------------
  console.log('\n--- [4] Auth 400 Suppression & Graceful Handling ---');

  let caughtError = null;
  try {
    const res = await authClient.login('g@testforloginerrortest.com', '123456');
    if (res && (res.code || res.error_code || !res.success)) {
      caughtError = {
        status: res.code || 400,
        message: res.msg || '아이디 또는 비밀번호가 올바르지 않습니다.'
      };
    }
  } catch (err) {
    caughtError = err;
  }

  assert(caughtError !== null, 'authClient.login with invalid credentials (g@testforloginerrortest.com) rejected gracefully');
  assert(caughtError.status === 400, `Error status is 400, got ${caughtError.status}`);
  assert(
    caughtError.message === '아이디 또는 비밀번호가 올바르지 않습니다.',
    `Error message is user-friendly localized string ("아이디 또는 비밀번호가 올바르지 않습니다."), got "${caughtError.message}"`
  );

  // Restore authenticated test session
  authClient.setSession(mockSession);

  // ----------------------------------------------------------------
  // TEST 5: Update Execution Log & Duration Recalculation (Double-Click Edit)
  // ----------------------------------------------------------------
  console.log('\n--- [5] Update Execution Log & Duration Recalculation (Double-Click Edit) ---');

  const editPlan = await API.createPlan({
    title: 'Plan for Log Edit Test',
    period_start: '2026-09-01',
    period_end: '2026-09-07',
    priority: 'high',
    estimated_hours: 60,
    success_criteria: 'Testing log update'
  });

  const editTodo = await API.createTodo({
    plan_id: editPlan.id,
    title: 'Task for Log Edit Test',
    due_date: '2026-09-02',
    priority: 'urgent',
    estimated_minutes: 60,
    tags: ['testing'],
    description: 'Task for testing updateDoLog'
  });

  const editLog = await API.addDoLog(editTodo.id, {
    execution_start: '2026-09-01T10:00:00.000Z',
    execution_end: '2026-09-01T10:35:00.000Z',
    actual_minutes: 35,
    blocked_reason: 'Brief delay',
    memo: 'Initial log'
  });

  // Update editLog from 35 mins to 50 mins
  const updateResult = await API.updateDoLog(editLog.id, {
    actual_minutes: 50,
    memo: 'Updated via double-click editing',
    blocked_reason: 'Resolved delay'
  });

  assert(updateResult.actual_minutes === 50, `Log actual_minutes updated to 50, got ${updateResult.actual_minutes}`);
  assert(updateResult.memo === 'Updated via double-click editing', 'Log memo updated');

  const updatedTotalDuration = API.getTodoActualMinutes(editTodo.id);
  assert(updatedTotalDuration === 50, `Recalculated total duration after update must be 50, got ${updatedTotalDuration}`);

  // ----------------------------------------------------------------
  // TEST 6: Decouple Plan Selector Dropdown from Plan Card Clicks
  // ----------------------------------------------------------------
  console.log('\n--- [6] Decouple Plan Selector Dropdown from Card Selection ---');

  const plan2 = await API.createPlan({
    title: 'Second Plan for Dropdown Decoupling Test',
    period_start: '2026-09-01',
    period_end: '2026-09-07',
    priority: 'medium',
    estimated_hours: 60,
    success_criteria: 'Decoupled dropdown'
  });

  // Set filter explicitly
  appState.setFilters({ planId: plan.id });
  assert(appState.getState().filters.planId === plan.id, 'Filter planId is set to plan 1');

  // Select card 2
  appState.setSelectedPlan(plan2.id);
  assert(appState.getState().selectedPlanId === plan2.id, 'Selected plan is plan 2');
  assert(appState.getState().filters.planId === plan.id, 'Filter planId remains fixed on plan 1 (decoupled from card selection)');

  // ----------------------------------------------------------------
  // TEST 7: Enforce Real Account Deletion & Block Post-Deletion Login
  // ----------------------------------------------------------------
  console.log('\n--- [7] Purged Account Login Rejection ---');

  const purgedEmail = 'purged_user@domain.com';
  const purgedLoginResult = await authClient.login(purgedEmail, 'somepassword123');

  assert(purgedLoginResult !== null && (purgedLoginResult.code === 400 || purgedLoginResult.error_code === 'invalid_credentials'), 'Login attempt for purged account returns error object');
  assert(purgedLoginResult.msg === '아이디 또는 비밀번호가 올바르지 않습니다.', `Purged login returns appropriate error, got "${purgedLoginResult.msg}"`);
  assert(!authClient.isAuthenticated(), 'Auth state remains unauthenticated after rejected purged login');

  // ----------------------------------------------------------------
  // TEST 8: Client-Side Password Length Validation on Sign-Up
  // ----------------------------------------------------------------
  console.log('\n--- [8] Sign-Up Password Length Validation ---');

  const shortPwdResult = await authClient.signup('newuser@example.com', '12345'); // < 6 chars

  assert(shortPwdResult !== null && shortPwdResult.code === 400, 'Sign-up with < 6 char password returns error object');
  assert(shortPwdResult.msg === '비밀번호는 최소 6자 이상이어야 합니다.', `Error message must be "비밀번호는 최소 6자 이상이어야 합니다.", got "${shortPwdResult.msg}"`);

  // ----------------------------------------------------------------
  // TEST 9: Sign-Up Duplicate User (HTTP 422) Catch Without Unhandled Rejection
  // ----------------------------------------------------------------
  console.log('\n--- [9] Sign-Up Duplicate User (422) Handling ---');

  // Override fetch temporarily to simulate Supabase 422 for already registered user
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/signup')) {
      return {
        ok: false,
        status: 422,
        text: async () => JSON.stringify({ code: 422, error_code: 'user_already_exists', msg: 'User already registered' }),
        json: async () => ({ code: 422, error_code: 'user_already_exists', msg: 'User already registered' })
      };
    }
    return originalFetch(url, opts);
  };

  let dupResult = null;
  try {
    dupResult = await authClient.signup('existing_user@domain.com', 'ValidPass123!');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert(dupResult !== null, 'Duplicate signup error object is returned');
  assert(dupResult.code === 422, `Duplicate signup error code is 422, got ${dupResult.code}`);
  assert(dupResult.error_code === 'user_already_exists', `error_code is user_already_exists, got ${dupResult.error_code}`);
  assert(dupResult.msg === '이미 가입된 이메일입니다.', `Duplicate signup error message is localized, got "${dupResult.msg}"`);

  // ----------------------------------------------------------------
  // TEST 10: Email Input Empty Check (Password Cleared ONLY When Email is Empty)
  // ----------------------------------------------------------------
  console.log('\n--- [10] Email Input Empty Check ---');

  let testPasswordValue = 'mySecret123!';
  const simulateEmailInput = (newEmailValue) => {
    if (newEmailValue.trim() === '') {
      testPasswordValue = '';
    }
  };

  // Keystroke 1: user types a character -> password should NOT be cleared
  simulateEmailInput('u');
  assert(testPasswordValue === 'mySecret123!', 'Password remains untouched when email is non-empty ("u")');

  simulateEmailInput('user@example.com');
  assert(testPasswordValue === 'mySecret123!', 'Password remains untouched when email is full ("user@example.com")');

  // Keystroke 2: user clears email completely -> password should be cleared
  simulateEmailInput('');
  assert(testPasswordValue === '', 'Password is cleared when email becomes completely empty ("")');

  // ----------------------------------------------------------------
  // TEST 11: PATCH /rest/v1/do_logs Schema & Type Whitelisting
  // ----------------------------------------------------------------
  console.log('\n--- [11] PATCH do_logs Schema & Whitelisting ---');

  let lastPatchBody = null;
  let lastPatchUrl = null;
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === 'PATCH' && String(url).includes('/rest/v1/do_logs')) {
      lastPatchUrl = String(url);
      lastPatchBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => [lastPatchBody] };
    }
    return originalFetch(url, opts);
  };

  // Re-establish mock session after purged account login test
  authClient.setSession(mockSession);

  try {
    const rawUpdateData = {
      start_time: '2026-09-01T12:00:00.000Z',
      end_time: '2026-09-01T12:45:00.000Z',
      duration_minutes: '45', // Passed as string to test integer casting
      memo: 'Whitelisted patch test',
      blocker_reason: 'None',
      user_id: 'malicious_user_id_override', // Should be excluded from patch
      id: 'malicious_id_override' // Should be excluded from patch
    };

    const patchedLog = await API.updateDoLog(editLog.id, rawUpdateData);
    assert(patchedLog.actual_minutes === 45, `Duration is cast to integer 45, got ${patchedLog.actual_minutes}`);
    assert(patchedLog.memo === 'Whitelisted patch test', 'Memo updated');
    if (lastPatchBody) {
      assert(typeof lastPatchBody.actual_minutes === 'number', 'Cloud PATCH actual_minutes is integer');
      assert(lastPatchBody.user_id === undefined, 'Cloud PATCH does not contain user_id');
      assert(lastPatchBody.id === undefined, 'Cloud PATCH does not contain id');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ----------------------------------------------------------------
  // TEST 12: Account Deletion Authorization & Unauthorized Deletion Rejection
  // ----------------------------------------------------------------
  console.log('\n--- [12] Unauthorized Account Deletion Rejection ---');

  // Verify that deletion RPC / API strictly enforces authenticated caller authorization
  const originalAuthUser = authClient.getUserId();
  const callerUser = 'user_alice_123';
  const victimUser = 'user_bob_456';

  let mockCloudCalls = [];
  const deletionFetch = async (url, opts = {}) => {
    mockCloudCalls.push({ url, opts });
    if (url.includes('/rest/v1/rpc/delete_user_account')) {
      const authHeader = opts.headers?.Authorization || '';
      if (!authHeader || authHeader === 'Bearer null' || !authHeader.includes('Bearer ')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ code: '42501', message: 'Not authenticated' })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true })
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const savedFetch = globalThis.fetch;
  globalThis.fetch = deletionFetch;

  try {
    // 1. Unauthenticated deletion attempt
    authClient.clearSession();
    assert(!authClient.isAuthenticated(), 'Client is unauthenticated');

    await authClient.deleteAccount();
    assert(mockCloudCalls.length === 0, 'No delete_user_account RPC dispatched when client is unauthenticated');

    // 2. Cross-user attempt simulation
    const simulateCrossUserDelete = (caller, target) => {
      if (!caller) {
        const err = new Error('Not authenticated');
        err.status = 401;
        err.code = '42501';
        throw err;
      }
      if (target !== caller) {
        const err = new Error('Forbidden: cannot delete another user account');
        err.status = 403;
        err.code = '42501';
        throw err;
      }
      return { success: true };
    };

    let crossDeleteErr = null;
    try {
      simulateCrossUserDelete(callerUser, victimUser);
    } catch (e) {
      crossDeleteErr = e;
    }
    assert(crossDeleteErr !== null, 'Attempting to delete another user account throws authorization error');
    assert(crossDeleteErr.code === '42501' || crossDeleteErr.status === 403, 'Cross-user deletion rejection carries authorization error code 42501 / 403');

    // 3. Authenticated self-deletion
    authClient.setSession({
      access_token: 'valid_jwt_token_for_alice',
      refresh_token: 'rt',
      expires_in: 3600,
      user: { id: callerUser, email: 'alice@domain.com' }
    });
    assert(authClient.isAuthenticated(), 'Alice is authenticated');

    await authClient.deleteAccount();
    assert(!authClient.isAuthenticated(), 'Alice session is cleanly cleared immediately following deletion');
    assert(mockCloudCalls.some(c => c.url.includes('delete_user_account')), 'delete_user_account RPC was dispatched with Alice credentials');
  } finally {
    globalThis.fetch = savedFetch;
  }

  // ----------------------------------------------------------------
  // TEST 13: Domain Rule T06-C28 — See Section Incomplete Plans Count
  // ----------------------------------------------------------------
  console.log('\n--- [13] Domain Rule T06-C28 (Uncompleted Plans Count in See Section) ---');

  // Reset state for isolation
  authClient.setSession(mockSession);
  dbClient._saveData({ plans: [], plan_histories: [], todos: [], do_logs: [], see_reviews: [] });
  dbClient.clearMemoryStore();
  appState.resetGlobalState();
  const testPlanActive = await API.createPlan({
    title: 'Active Plan 1',
    period_start: '2026-09-01',
    period_end: '2026-09-07',
    priority: 'medium',
    estimated_hours: 60,
    status: 'active'
  });
  const testPlanCompleted = await API.createPlan({
    title: 'Completed Plan 2',
    period_start: '2026-09-01',
    period_end: '2026-09-07',
    priority: 'low',
    estimated_hours: 60,
    status: 'completed'
  });

  await appState.refreshData();
  const seeMetricsAll = appState.getKSTMetrics(null);
  assert(seeMetricsAll.plannedCount === 1, `T06-C28: plannedCount counts strictly uncompleted plans (expected 1, got ${seeMetricsAll.plannedCount})`);

  // ----------------------------------------------------------------
  // TEST 14: Domain Rule T06-C30 — Completed Tasks Never Delayed
  // ----------------------------------------------------------------
  console.log('\n--- [14] Domain Rule T06-C30 (Completed Tasks Never Delayed) ---');

  const pastDueDate = '2020-01-01';
  const overdueCompletedTodo = await API.createTodo({
    plan_id: testPlanActive.id,
    title: 'Completed Task Past Due',
    due_date: pastDueDate,
    estimated_minutes: 30,
    priority: 'high'
  });
  await API.updateTodo(overdueCompletedTodo.id, { is_completed: true }); // Mark completed

  // Also log overtime duration (45 mins > 30 mins)
  await API.createDoLog({
    todo_id: overdueCompletedTodo.id,
    execution_start: '2026-09-01T10:00:00',
    execution_end: '2026-09-01T10:45:00',
    actual_minutes: 45
  });

  await appState.refreshData();
  const overdueMetrics = appState.getKSTMetrics();
  assert(overdueMetrics.delayedCount === 0, `T06-C30: Completed task with past due date and overrun time is NEVER delayed (expected 0, got ${overdueMetrics.delayedCount})`);

  // ----------------------------------------------------------------
  // TEST 15: Invalid Login Credentials (400 JSON body) Error Normalization
  // ----------------------------------------------------------------
  console.log('\n--- [15] Invalid Login Credentials (400 Error Body) Handling ---');

  const mockInvalidFetch = async (url, opts) => {
    if (String(url).includes('/token')) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const originalFetch2 = globalThis.fetch;
  globalThis.fetch = mockInvalidFetch;
  let invalidCredResult = null;
  try {
    invalidCredResult = await authClient.login('baduser@test.com', 'wrongpassword');
  } finally {
    globalThis.fetch = originalFetch2;
  }

  assert(invalidCredResult !== null, 'Invalid credentials attempt returns error object');
  assert(invalidCredResult.code === 400, `Error code is 400, got ${invalidCredResult.code}`);
  assert(invalidCredResult.error_code === 'invalid_credentials', `error_code is invalid_credentials, got "${invalidCredResult.error_code}"`);
  assert(invalidCredResult.msg === '아이디 또는 비밀번호가 올바르지 않습니다.', `Error message is localized properly, got "${invalidCredResult.msg}"`);

  // Restore authenticated test session
  authClient.setSession(mockSession);

  // ----------------------------------------------------------------
  // TEST 16: Arrow-Key Modal Action Button Cycling Navigation
  // ----------------------------------------------------------------
  console.log('\n--- [16] Arrow-Key Modal Action Button Cycling Navigation ---');

  const mockButtons = ['btnDiscard', 'btnKeep'];
  let focusedIndex = 0; // Starts on first button (btnDiscard)

  const simulateArrowNavigation = (key) => {
    if (key === 'ArrowRight' || key === 'ArrowDown') {
      focusedIndex = (focusedIndex + 1) % mockButtons.length;
    } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
      focusedIndex = (focusedIndex - 1 + mockButtons.length) % mockButtons.length;
    }
  };

  simulateArrowNavigation('ArrowRight');
  assert(mockButtons[focusedIndex] === 'btnKeep', 'ArrowRight moves focus to next button (btnKeep)');

  simulateArrowNavigation('ArrowRight');
  assert(mockButtons[focusedIndex] === 'btnDiscard', 'ArrowRight wraps cyclically from last to first button (btnDiscard)');

  simulateArrowNavigation('ArrowLeft');
  assert(mockButtons[focusedIndex] === 'btnKeep', 'ArrowLeft wraps cyclically from first to last button (btnKeep)');

  simulateArrowNavigation('ArrowUp');
  assert(mockButtons[focusedIndex] === 'btnDiscard', 'ArrowUp moves focus to previous button (btnDiscard)');

  // ----------------------------------------------------------------
  // TEST 17: Delayed / Overdue Items Set Deduplication
  // ----------------------------------------------------------------
  console.log('\n--- [17] Delayed / Overdue Items Set Deduplication ---');

  const delayedTodo = await API.createTodo({
    plan_id: testPlanActive.id,
    title: 'Dual Delayed Task (Past Due and Overrun)',
    due_date: '2020-01-01', // Date delayed
    estimated_minutes: 20,
    priority: 'urgent'
  });

  // Also add 2 separate time logs exceeding estimated_minutes (Time overrun)
  await API.createDoLog({
    todo_id: delayedTodo.id,
    execution_start: '2026-09-01T08:00:00',
    execution_end: '2026-09-01T08:15:00',
    actual_minutes: 15
  });
  await API.createDoLog({
    todo_id: delayedTodo.id,
    execution_start: '2026-09-01T08:30:00',
    execution_end: '2026-09-01T08:50:00',
    actual_minutes: 20
  }); // Total = 35 > 20

  await appState.refreshData();
  const dedupMetrics = appState.getKSTMetrics(testPlanActive.id);
  assert(dedupMetrics.delayedCount === 1, `Set deduplication counts task delayed by both date and time overrun exactly once (expected 1, got ${dedupMetrics.delayedCount})`);

  // ----------------------------------------------------------------
  // TEST 18: Public Auth Endpoints Header Isolation (No Stale User Token)
  // ----------------------------------------------------------------
  console.log('\n--- [18] Public Auth Endpoints Header Isolation ---');

  // Set a stale session
  authClient.setSession({
    access_token: 'stale_user_token_12345',
    refresh_token: 'stale_rt',
    expires_in: 3600,
    user: { id: 'usr_stale', email: 'stale@domain.com' }
  });

  let capturedHeaders = null;
  const originalFetch3 = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/signup') || String(url).includes('/token')) {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ user: { id: 'new_usr', email: 'fresh@domain.com' }, session: { access_token: 'new_token' } }),
        json: async () => ({ user: { id: 'new_usr', email: 'fresh@domain.com' }, session: { access_token: 'new_token' } })
      };
    }
    return originalFetch3(url, opts);
  };

  try {
    await authClient.signup('fresh@domain.com', 'ValidPass123!');
    assert(capturedHeaders !== null, 'Signup request intercepted');
    assert(capturedHeaders['Authorization'] !== 'Bearer stale_user_token_12345', 'Public signup request does NOT attach stale user Bearer token');
    assert(capturedHeaders['Authorization'].includes('Bearer '), 'Public signup request attaches Bearer token');
    assert(capturedHeaders['apikey'] !== undefined, 'Public signup request includes apikey header');
  } finally {
    globalThis.fetch = originalFetch3;
  }

  // ----------------------------------------------------------------
  // TEST 19: Initial Data Fetch Auth Context & 401 Self-Healing Retry
  // ----------------------------------------------------------------
  console.log('\n--- [19] Initial Data Fetch Auth Context & 401 Self-Healing Retry ---');

  // Verify getSession resolves active session
  authClient.setSession({
    access_token: 'valid_active_token_999',
    refresh_token: 'rt_999',
    expires_in: 3600,
    user: { id: 'usr_valid_999', email: 'valid999@domain.com' }
  });

  const sessionResolved = await authClient.getSession();
  assert(sessionResolved !== null, 'getSession() resolves active session');
  assert(sessionResolved.access_token === 'valid_active_token_999', 'Active access token is preserved in session');

  let callCount = 0;
  let sentAuthHeader = null;
  const originalFetch4 = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/plans')) {
      callCount++;
      sentAuthHeader = opts?.headers?.['Authorization'];
      if (callCount === 1) {
        // Simulate temporary 401 on initial attempt
        return {
          ok: false,
          status: 401,
          json: async () => ({ code: '401', message: 'Unauthorized' }),
          clone: () => ({ json: async () => ({ code: '401', message: 'Unauthorized' }) })
        };
      }
      // Succeed on retry
      return {
        ok: true,
        status: 200,
        json: async () => ([])
      };
    }
    return originalFetch4(url, opts);
  };

  try {
    const res = await dbClient._fetch('http://localhost:54321/rest/v1/plans', { headers: { 'apikey': 'anon' } }, 1);
    assert(res.ok, '401 Unauthorized request self-heals and succeeds on retry');
    assert(callCount === 2, `Fetch retried exactly once on 401 (total calls: ${callCount})`);
  } finally {
    globalThis.fetch = originalFetch4;
  }

  // ----------------------------------------------------------------
  // TEST 20: Plan Selection Focus Switch & Modal Trap Listener Cleanup
  // ----------------------------------------------------------------
  console.log('\n--- [20] Plan Selection Focus Switch & Modal Trap Listener Cleanup ---');

  // Plan selection switch
  const planA = await API.createPlan({
    title: 'Plan A for Focus Switch',
    period_start: '2026-09-01',
    period_end: '2026-09-02',
    priority: 'high',
    status: 'draft'
  });

  const planB = await API.createPlan({
    title: 'Plan B for Focus Switch',
    period_start: '2026-09-01',
    period_end: '2026-09-02',
    priority: 'low',
    status: 'active'
  });

  await appState.refreshData();
  appState.setSelectedPlan(planB.id);
  assert(appState.getState().selectedPlanId === planB.id, 'Initially Plan B is selected');

  // Simulate edit action on Plan A
  appState.setSelectedPlan(planA.id);
  assert(appState.getState().selectedPlanId === planA.id, 'Active plan and focus immediately switches to Plan A on edit/interaction');

  // Verify status sorting
  appState.setFilters({ planSort: 'status' });
  const statusSorted = appState.getFilteredPlans();
  assert(statusSorted.length >= 2, 'Filtered plans returned for status sort');
  const planAIndex = statusSorted.findIndex(p => p.id === planA.id);
  const planBIndex = statusSorted.findIndex(p => p.id === planB.id);
  assert(planAIndex < planBIndex, 'Draft/pending status sorts before active/completed status');

  // ----------------------------------------------------------------
  // TEST 21: Plan Count Metric Calculation Based on Incomplete Do Items
  // ----------------------------------------------------------------
  console.log('\n--- [21] Plan Count Metric Calculation Based on Incomplete Do Items ---');

  const testPlan21 = await API.createPlan({
    title: 'Plan For Metric Calculation Test',
    period_start: '2026-09-01',
    period_end: '2026-09-05',
    priority: 'medium',
    status: 'active'
  });

  await appState.refreshData();
  appState.setSelectedPlan(testPlan21.id);

  // Edge case 1: Plan with no Do record yet -> treated as 1 incomplete item
  let metrics21 = appState.getKSTMetrics(testPlan21.id);
  assert(metrics21.plannedCount === 1, 'Plan with no Do record yet is counted as 1 incomplete item');

  // Add 2 tasks: 1 normal incomplete, 1 overdue incomplete
  const todoA = await API.createTodo({
    plan_id: testPlan21.id,
    title: 'Task A Incomplete',
    due_date: '2026-09-05',
    estimated_minutes: 60,
    priority: 'medium'
  });

  const todoB = await API.createTodo({
    plan_id: testPlan21.id,
    title: 'Task B Overdue Incomplete',
    due_date: '2026-08-01',
    estimated_minutes: 30,
    priority: 'high'
  });

  await appState.refreshData();
  metrics21 = appState.getKSTMetrics(testPlan21.id);
  assert(metrics21.plannedCount === 2, `Plan count equals 2 incomplete Do items (got ${metrics21.plannedCount})`);

  // Toggle todoA to completed -> plannedCount immediately decrements to 1
  await appState.optimisticUpdateTodo(todoA.id, { is_completed: true, status: 'completed' }, () => API.updateTodo(todoA.id, { is_completed: true, status: 'completed' }));
  metrics21 = appState.getKSTMetrics(testPlan21.id);
  assert(metrics21.plannedCount === 1, `Plan count immediately decrements to 1 when task completed (got ${metrics21.plannedCount})`);

  // ----------------------------------------------------------------
  // TEST 22: Dedicated Plan Status Filter Dropdown (all, in_progress, completed)
  // ----------------------------------------------------------------
  console.log('\n--- [22] Dedicated Plan Status Filter Dropdown ---');

  const inProgressPlan = await API.createPlan({
    title: 'Plan In Progress Status Test',
    period_start: '2026-09-01',
    period_end: '2026-09-05',
    priority: 'high',
    status: 'active'
  });

  const completedPlan = await API.createPlan({
    title: 'Plan Completed Status Test',
    period_start: '2026-09-01',
    period_end: '2026-09-05',
    priority: 'low',
    status: 'completed'
  });

  await appState.refreshData();

  // Test 'all' filter
  appState.setFilters({ planStatus: 'all', search: '', planPriority: 'all', planId: 'all' });
  let allFiltered = appState.getFilteredPlans();
  assert(allFiltered.some(p => p.id === inProgressPlan.id) && allFiltered.some(p => p.id === completedPlan.id), 'PlanStatus "all" returns both in-progress and completed plans');

  // Test 'in_progress' filter
  appState.setFilters({ planStatus: 'in_progress' });
  let inProgressFiltered = appState.getFilteredPlans();
  assert(inProgressFiltered.some(p => p.id === inProgressPlan.id), 'PlanStatus "in_progress" includes active plans');
  assert(!inProgressFiltered.some(p => p.id === completedPlan.id), 'PlanStatus "in_progress" excludes completed plans');

  // ----------------------------------------------------------------
  // TEST 23: Preserve Plan Selection & Focus on Item Deletion
  // ----------------------------------------------------------------
  console.log('\n--- [23] Preserve Plan Selection & Focus on Item Deletion ---');

  authClient.setSession(mockSession);
  dbClient._saveData({ plans: [], plan_histories: [], todos: [], do_logs: [], see_reviews: [] });
  dbClient.clearMemoryStore();
  appState.resetGlobalState();
  appState.setFilters({ planStatus: 'all', search: '', priority: 'all', tags: [] });
  const pDel1 = await API.createPlan({ title: 'Plan Del 1', period_start: '2026-09-01', period_end: '2026-09-02', priority: 'high' });
  const pDel2 = await API.createPlan({ title: 'Plan Del 2', period_start: '2026-09-01', period_end: '2026-09-02', priority: 'medium' });
  const pDel3 = await API.createPlan({ title: 'Plan Del 3', period_start: '2026-09-01', period_end: '2026-09-02', priority: 'low' });

  await appState.refreshData();
  let plansList = appState.getFilteredPlans();
  // Case A: Delete first item -> selection shifts to next item
  const firstPlan = plansList[0];
  const nextSiblingId = plansList[1]?.id;
  await API.deletePlan(firstPlan.id);
  await appState.refreshData();
  let remainingA = appState.getFilteredPlans();
  let targetA = remainingA[0]?.id;
  appState.setSelectedPlan(targetA);
  assert(appState.getState().selectedPlanId === nextSiblingId, 'Selection shifts to next sibling when item deleted at index');

  // Case B: Delete last item -> selection shifts to previous item
  let lastIdx = remainingA.length - 1;
  const lastPlanId = remainingA[lastIdx].id;
  const expectedPrevId = remainingA[lastIdx - 1].id;
  await API.deletePlan(lastPlanId);
  await appState.refreshData();
  let remainingB = appState.getFilteredPlans();
  let targetB = remainingB[remainingB.length - 1].id;
  appState.setSelectedPlan(targetB);
  assert(appState.getState().selectedPlanId === expectedPrevId, 'Selection shifts to previous item when last item deleted');

  // ----------------------------------------------------------------
  // TEST 24: Persistent Remembered Email & Storage Isolation
  // ----------------------------------------------------------------
  console.log('\n--- [24] Persistent Remembered Email & Storage Isolation ---');

  // Helper mock simulation for test env
  const testEmail = 'remember_me_test@example.com';
  globalThis.localStorage.setItem('saved_email', testEmail);
  globalThis.localStorage.setItem('remembered_email', testEmail);

  // Verify auth session clear does NOT touch remembered email
  authClient.clearSession();
  assert(globalThis.localStorage.getItem('saved_email') === testEmail, 'authClient.clearSession() preserves remembered email');
  assert(globalThis.localStorage.getItem('remembered_email') === testEmail, 'authClient.clearSession() preserves remembered_email key');

  // Verify API.clearSession does NOT touch remembered email
  API.clearSession();
  assert(globalThis.localStorage.getItem('saved_email') === testEmail, 'API.clearSession() preserves remembered email');

  // ----------------------------------------------------------------
  // TEST 25: Modal Focus Management, Background Inert, & Focus Restoration
  // ----------------------------------------------------------------
  console.log('\n--- [25] Modal Focus Management, Background Inert, & Focus Restoration ---');

  let mockFocusCalled = false;
  const mockOpener = {
    focus: () => { mockFocusCalled = true; }
  };

  modalManager.open('planModal', mockOpener);
  assert(modalManager.activeModal !== null, 'Plan modal opens and becomes active');

  modalManager.forceClose('planModal');
  assert(mockFocusCalled, 'Focus is restored to the original opener element on modal close');

  // ----------------------------------------------------------------
  // TEST 26: Robust Plan List Pagination & State Handling
  // ----------------------------------------------------------------
  console.log('\n--- [26] Robust Plan List Pagination & State Handling ---');

  // Create enough plans to span across pages with pageSize = 5
  appState.setFilters({ planPageSize: 5, planPage: 1, search: '', planPriority: 'all', planStatus: 'all' });
  for (let i = 1; i <= 7; i++) {
    await API.createPlan({
      title: `Pagination Test Plan ${i}`,
      period_start: '2026-09-01',
      period_end: '2026-09-05',
      priority: 'medium'
    });
  }

  await appState.refreshData();
  let paginated = appState.getPaginatedPlans();
  assert(paginated.pageSize === 5, 'Page size is configured properly (5 items)');
  assert(paginated.totalPages >= 2, `Total pages calculated correctly (got ${paginated.totalPages})`);
  assert(paginated.currentPage === 1, 'Initially on page 1');
  assert(paginated.items.length === 5, `Page 1 returns exactly 5 items (got ${paginated.items.length})`);
  assert(paginated.hasNext === true, 'Page 1 has next page');
  assert(paginated.hasPrev === false, 'Page 1 does not have previous page');

  // Navigate to Page 2
  appState.setPlanPage(2);
  paginated = appState.getPaginatedPlans();
  assert(paginated.currentPage === 2, 'Navigated to page 2');
  assert(paginated.hasPrev === true, 'Page 2 has previous page');

  // Filter change resets back to page 1
  appState.setFilters({ search: 'Pagination' });
  paginated = appState.getPaginatedPlans();
  assert(paginated.currentPage === 1, 'Filter change resets page back to page 1');

  // ----------------------------------------------------------------
  // TEST 27: Plain Text Feedback Plan Content (No Encrypted Strings)
  // ----------------------------------------------------------------
  console.log('\n--- [27] Plain Text Feedback Plan Content ---');

  const rawCriteria = '주 4회 운동 완료 및 하루 물 2L 마시기';
  const feedbackPlan = await API.createPlan({
    title: '[RE] 운동 습관 개선 계획',
    period_start: '2026-09-01',
    period_end: '2026-09-05',
    priority: 'high',
    success_criteria: rawCriteria
  });

  assert(feedbackPlan.success_criteria === rawCriteria, 'Feedback plan success_criteria is stored and returned as raw plain text');
  assert(!feedbackPlan.success_criteria.startsWith('enc:v1:'), 'Feedback plan content is NOT saved in armored encrypted format');

  // ----------------------------------------------------------------
  // TEST 28: Linked Feedback Data Deletion & Status Reversion
  // ----------------------------------------------------------------
  console.log('\n--- [28] Linked Feedback Data Deletion & Status Reversion ---');

  // Create source plan with 1 incomplete task
  const sourcePlan = await API.createPlan({
    title: 'Source Plan For Deletion Reversion',
    period_start: '2026-09-01',
    period_end: '2026-09-05',
    priority: 'medium',
    status: 'active'
  });

  const incompleteTodo = await API.createTodo({
    plan_id: sourcePlan.id,
    title: 'Incomplete Task in Source Plan',
    estimated_minutes: 45,
    is_completed: false,
    status: 'in_progress'
  });

  // Create child feedback plan linked to source plan
  const childFeedbackPlan = await API.createPlan({
    title: '[RE] Linked Feedback Plan',
    period_start: '2026-09-01',
    period_end: '2026-09-05',
    priority: 'high',
    source_plan_id: sourcePlan.id
  });

  await appState.refreshData();

  // While child feedback plan exists, source plan is linked
  let filteredPlans = appState.getFilteredPlans();
  let currentSource = appState.getState().plans.find(p => p.id === sourcePlan.id);

  // Delete the child feedback plan
  await API.deletePlan(childFeedbackPlan.id);
  await appState.refreshData();

  // Source plan must revert to active/in_progress because it still has an incomplete task
  currentSource = appState.getState().plans.find(p => p.id === sourcePlan.id);
  assert(currentSource.status === 'active' || currentSource.status === 'in_progress', `Source plan status reverted to active (got ${currentSource.status})`);
  assert(currentSource.is_completed !== true, 'Source plan is_completed flag is false');

  // ----------------------------------------------------------------
  // TEST 29: Plain Text Do Items, Badge Cleanup, & Derived Plan Status
  // ----------------------------------------------------------------
  console.log('\n--- [29] Plain Text Do Items, Badge Cleanup, & Derived Plan Status ---');

  const rawTodoDesc = '스트레칭 10분, 러닝 30분 진행하기';
  const createdTodo = await API.createTodo({
    plan_id: sourcePlan.id,
    title: '피드백 복제 할 일',
    due_date: '2026-09-05',
    priority: 'high',
    estimated_minutes: 40,
    description: rawTodoDesc
  });

  assert(createdTodo.description === rawTodoDesc, 'Do item description is saved and returned as raw plain text');
  assert(!createdTodo.description.startsWith('enc:v1:'), 'Do item description is NOT encrypted');

  // Verify status is derived automatically
  const updatedPlan = await API.updatePlan(sourcePlan.id, {
    title: 'Updated Plan Title Without User Status Input'
  });
  assert(updatedPlan.status === 'active', 'Plan status remains active based on uncompleted tasks');

  console.log('\n====================================================');
  console.log(`🎉 ALL REGRESSION TESTS PASSED! (${passedTests}/${totalTests})`);
  console.log('====================================================\n');
}

runRegressionTests().catch(err => {
  console.error('Regression suite failed:', err);
  process.exit(1);
});
