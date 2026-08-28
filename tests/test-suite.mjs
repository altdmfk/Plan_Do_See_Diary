/**
 * Automated Verification Test Suite for Plan-Do-See Diary
 */

import { getKSTParts, getKSTToday, getKSTWeekRange, isSameKSTWeek, getKSTMonthRange, isDelayedKST, calculateElapsedMinutes } from '../js/dateUtils.js';
import { validateFileSize, migrateLegacySchema, validateImportPayload } from '../js/validators.js';
import { dbClient } from '../js/supabaseClient.js';
import { API } from '../js/api.js';
import { escapeHtml } from '../js/ui.js';
import { CONFIG } from '../js/config.js';
import { encryptText, decryptText, isEncrypted } from '../js/crypto.js';
import { appState } from '../js/state.js';
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

// Global mock for localStorage & window in Node.js environment
global.localStorage = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

async function runAllTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING PLAN-DO-SEE DIARY AUTOMATED TEST SUITE');
  console.log('====================================================\n');

  // --- 1. KST DATE & CALENDAR BOUNDARIES ---
  console.log('--- [1] Strict KST Date Engine Tests ---');
  const today = getKSTToday();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(today), `Today in KST is formatted as YYYY-MM-DD (${today})`);

  // Test Monday-Sunday Week boundary for a known date: 2026-08-28 (Friday)
  const weekRange = getKSTWeekRange('2026-08-28T12:00:00Z');
  assert(weekRange.start === '2026-08-24', `Week start is Monday 2026-08-24 (got ${weekRange.start})`);
  assert(weekRange.end === '2026-08-30', `Week end is Sunday 2026-08-30 (got ${weekRange.end})`);
  assert(isSameKSTWeek('2026-08-24', '2026-08-30') === true, 'Monday and Sunday of same week match isSameKSTWeek');
  assert(isSameKSTWeek('2026-08-23', '2026-08-24') === false, 'Sunday and next Monday are classified as different weeks');

  // Test Leap Year Month boundary: 2024-02-15
  const leapMonthRange = getKSTMonthRange('2024-02-15T00:00:00Z');
  assert(leapMonthRange.start === '2024-02-01', 'Leap year Feb start is 2024-02-01');
  assert(leapMonthRange.end === '2024-02-29', `Leap year Feb end is 2024-02-29 (got ${leapMonthRange.end})`);

  // Test Non-Leap Year Month boundary: 2025-02-15
  const nonLeapMonthRange = getKSTMonthRange('2025-02-15T00:00:00Z');
  assert(nonLeapMonthRange.end === '2025-02-28', `Non-leap year Feb end is 2025-02-28 (got ${nonLeapMonthRange.end})`);

  // Test Delay logic
  assert(isDelayedKST('2020-01-01', false) === true, 'Past due date incomplete task is delayed');
  assert(isDelayedKST('2020-01-01', true) === false, 'Completed tasks are never classified as delayed');
  assert(isDelayedKST('2099-01-01', false) === false, 'Future due date task is not delayed');

  // Test Duration calculation with drift correction
  const elapsed = calculateElapsedMinutes('2026-08-28T09:00:00Z', '2026-08-28T09:45:00Z');
  assert(elapsed === 45, `Duration calculation matches 45 minutes (got ${elapsed})`);

  // --- 2. XSS DEFENSE ---
  console.log('\n--- [2] XSS Sanitization Tests ---');
  const xssInput = '<script>alert("xss")</script><img src=x onerror="hack()">';
  const sanitized = escapeHtml(xssInput);
  assert(!sanitized.includes('<script>'), 'Script tags escaped');
  assert(sanitized.includes('&lt;script&gt;'), 'Safe literal entity conversion verified');

  // --- 3. ATOMIC IMPORT & LEGACY MIGRATION (1 Legacy + 4 Invalid Files + Lifecycle) ---
  console.log('\n--- [3] Import Validation, 1 Legacy Format & 4 Invalid Files Tests ---');
  
  // [3a] 1 Legacy Format Test (이전 형식 1건 v1 마이그레이션)
  const legacyV1 = {
    version: '1.0.0',
    plans: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        plan_title: 'Legacy Plan Title',
        start_date: '2026-01-01',
        end_date: '2026-01-07',
        criteria: 'Finish v1',
        estimated_minutes: 120
      }
    ],
    todos: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        plan_id: '11111111-1111-4111-8111-111111111111',
        task_name: 'Legacy Task',
        deadline: '2026-01-07',
        completed: false
      }
    ],
    do_logs: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        todo_id: '22222222-2222-4222-8222-222222222222',
        start_time: '2026-01-01T10:00:00Z',
        end_time: '2026-01-01T10:30:00Z',
        duration_minutes: 30,
        blocker: 'Legacy obstacle'
      }
    ]
  };

  const migrated = migrateLegacySchema(legacyV1, 'scope_a');
  assert(migrated.version === '2.0.0', 'Legacy v1 schema version upgraded to 2.0.0');
  assert(migrated.plans[0].title === 'Legacy Plan Title', 'Legacy plan_title mapped to title');
  assert(migrated.plans[0].estimated_hours === 2, 'Legacy estimated_minutes converted to estimated_hours');
  assert(migrated.todos[0].title === 'Legacy Task', 'Legacy task_name mapped to title');
  assert(migrated.do_logs[0].blocked_reason === 'Legacy obstacle', 'Legacy blocker mapped to blocked_reason');
  const validatedMigrated = validateImportPayload(migrated, 'scope_a');
  assert(validatedMigrated.plans.length === 1, 'Validated migrated legacy payload successfully');

  // [3b] 4 Invalid Files Tests (잘못된 파일 4건 거부 검증)
  // Invalid File 1: 5MB File Size Exceeded (용량 5MB 초과 파일)
  let invalid1Blocked = false;
  try {
    await API.importBackup(JSON.stringify(migrated), 6 * 1024 * 1024);
  } catch (err) {
    invalid1Blocked = err.message.includes('5MB limit');
  }
  assert(invalid1Blocked, 'Invalid File 1 Rejected: Payload > 5MB blocked with 5MB limit error');

  // Invalid File 2: Malformed JSON Syntax (구문 오류 / 비정상 JSON 파일)
  let invalid2Blocked = false;
  try {
    await API.importBackup('{ malformed_json: true, ...broken', 100);
  } catch (err) {
    invalid2Blocked = err.message.includes('Malformed JSON');
  }
  assert(invalid2Blocked, 'Invalid File 2 Rejected: Malformed non-JSON syntax blocked with parse error');

  // Invalid File 3: Duplicate Primary Key Collision (기본키 중복 파일)
  const duplicateIdPayload = JSON.parse(JSON.stringify(migrated));
  duplicateIdPayload.todos.push({
    id: '11111111-1111-4111-8111-111111111111', // Collision with Plan ID
    plan_id: '11111111-1111-4111-8111-111111111111',
    title: 'Collision Task',
    due_date: '2026-01-07',
    priority: 'medium',
    is_completed: false
  });
  let invalid3Blocked = false;
  try {
    validateImportPayload(duplicateIdPayload, 'scope_a');
  } catch (err) {
    invalid3Blocked = err.message.includes('Duplicate primary key ID');
  }
  assert(invalid3Blocked, 'Invalid File 3 Rejected: Duplicate primary key ID detected and blocked atomically');

  // Invalid File 4: Missing Required Fields & Invalid Schema (필수 필드 누락 / 계약 위반 파일)
  const missingFieldPayload = {
    version: '2.0.0',
    scope: 'scope_a',
    plans: [
      {
        id: crypto.randomUUID(),
        // Missing required title
        period_start: 'invalid-date-format', // Broken date
        period_end: '2026-01-07',
        priority: 'high',
        status: 'active'
      }
    ]
  };
  let invalid4Blocked = false;
  try {
    validateImportPayload(missingFieldPayload, 'scope_a');
  } catch (err) {
    invalid4Blocked = err.message.includes('Validation failed');
  }
  assert(invalid4Blocked, 'Invalid File 4 Rejected: Missing required fields and broken dates blocked by contract schema');

  // [3c] Export -> Purge All -> Import Empty State Lifecycle Test (내보내기 → 전체 삭제 → 빈 상태 가져오기)
  dbClient.setSessionScope('scope_a');
  const exported = await API.exportBackup();
  assert(exported.version === '2.0.0' && exported.scope === 'scope_a', 'Lifecycle 1: Exported backup matches formal contract v2');

  await API.purgeCurrentScope();
  const stateAfterPurge = await API.fetchAll();
  assert(stateAfterPurge.plans.length === 0 && stateAfterPurge.todos.length === 0, 'Lifecycle 2: Purge cleared all tables to exactly 0 rows');

  const emptyBackupJson = JSON.stringify({
    version: '2.0.0',
    scope: 'scope_a',
    plans: [],
    plan_histories: [],
    todos: [],
    do_logs: [],
    see_reviews: []
  });
  await API.importBackup(emptyBackupJson, emptyBackupJson.length);
  const stateAfterEmptyImport = await API.fetchAll();
  assert(
    stateAfterEmptyImport.plans.length === 0 &&
    stateAfterEmptyImport.todos.length === 0 &&
    stateAfterEmptyImport.do_logs.length === 0 &&
    stateAfterEmptyImport.see_reviews.length === 0,
    'Lifecycle 3: Importing empty state backup cleanly maintained 0 rows across all tables'
  );

  // --- 4. DATABASE LAYER & SCOPE ISOLATION ---
  console.log('\n--- [4] Database Layer & Persona Scope Isolation Tests ---');

  // Load Scope A
  dbClient.setSessionScope('scope_a');
  dbClient._saveScopeData('scope_a', dbClient._createSeedData('scope_a'));
  const scopeAData = await dbClient.fetchAll('scope_a');
  assert(scopeAData.scope === 'scope_a', 'Scope A data loaded successfully');
  const initialScopeAPlanCount = scopeAData.plans.length;
  assert(initialScopeAPlanCount > 0, 'Scope A has seeded synthetic data');

  // Cross-scope read attempt from Scope A to Scope B should be rejected
  try {
    await dbClient.fetchAll('scope_b');
    assert(false, 'Cross-scope access should be rejected with 403');
  } catch (err) {
    assert(err.status === 403, 'Cross-scope read blocked by server-side RLS with HTTP 403');
  }

  // Plan Revision Snapshot Trigger Test
  const planA = scopeAData.plans[0];
  await dbClient.updatePlan(planA.id, {
    title: 'Updated Strategic Goal',
    revision_reason: 'Testing immutable snapshot trigger'
  });

  const scopeAUpdated = await dbClient.fetchAll('scope_a');
  assert(scopeAUpdated.plans[0].title === 'Updated Strategic Goal', 'Plan title updated');
  assert(scopeAUpdated.plan_histories.length > 0, 'Snapshot automatically created in plan_histories');
  assert(scopeAUpdated.plan_histories[0].title === planA.title, 'Historical snapshot preserved original title');

  // Idempotent ToDo Completion Test
  const todoA = scopeAUpdated.todos[0];
  const completionToken = 'test-token-12345';
  
  // First completion request
  const res1 = await dbClient.completeTodoIdempotent(todoA.id, {
    execution_start: '2026-08-28T09:00:00Z',
    execution_end: '2026-08-28T09:30:00Z',
    actual_minutes: 30,
    blocked_reason: ''
  }, completionToken);
  assert(res1.isDuplicate === false, 'First completion created new do_log');

  // Duplicate completion request with same token
  const res2 = await dbClient.completeTodoIdempotent(todoA.id, {
    execution_start: '2026-08-28T09:00:00Z',
    execution_end: '2026-08-28T09:30:00Z',
    actual_minutes: 30,
    blocked_reason: ''
  }, completionToken);
  assert(res2.isDuplicate === true, 'Duplicate completion request deduplicated via idempotent token');

  // Scope Reset & Cross-Scope Preservation Test
  // Load Scope B first to establish Scope B initial state
  dbClient.setSessionScope('scope_b');
  const scopeBInitial = await dbClient.fetchAll('scope_b');
  const scopeBInitialPlanCount = scopeBInitial.plans.length;
  assert(scopeBInitialPlanCount > 0, 'Scope B initialized with synthetic data');

  // Switch back to Scope A and Purge to 0 rows
  dbClient.setSessionScope('scope_a');
  await dbClient.purgeActiveScope();
  const scopeAPurged = await dbClient.fetchAll('scope_a');
  assert(scopeAPurged.plans.length === 0, 'Scope A purged to exactly 0 plans');
  assert(scopeAPurged.todos.length === 0, 'Scope A purged to exactly 0 todos');
  assert(scopeAPurged.do_logs.length === 0, 'Scope A purged to exactly 0 do_logs');

  // Verify Scope B remained 100% UNTOUCHED (0 altered rows)
  dbClient.setSessionScope('scope_b');
  const scopeBAfterPurge = await dbClient.fetchAll('scope_b');
  assert(scopeBAfterPurge.plans.length === scopeBInitialPlanCount, 'Scope B remained 100% untouched after Scope A reset');

  // Idempotent re-import test
  const restoredPayload = {
    version: '2.0.0',
    scope: 'scope_a',
    plans: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        scope: 'scope_a',
        title: 'Restored Plan',
        period_start: '2026-08-28',
        period_end: '2026-08-28',
        priority: 'high',
        success_criteria: 'Zero duplicates',
        estimated_hours: 4.0,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ],
    plan_histories: [],
    todos: [],
    do_logs: [],
    see_reviews: []
  };

  dbClient.setSessionScope('scope_a');
  await dbClient.restoreScopeBackup(restoredPayload);
  await dbClient.restoreScopeBackup(restoredPayload); // Re-import same data
  const scopeAAfterDoubleImport = await dbClient.fetchAll('scope_a');
  assert(scopeAAfterDoubleImport.plans.length === 1, 'Repeated import produced 0 duplicate rows (idempotent upsert)');

  // --- 4c. STRICT CROSS-SCOPE SERVER REJECTION TESTS (T06-C49 ~ T06-C54) ---
  console.log('\n--- [4c] Strict Cross-Scope Server Rejection Tests (T06-C49 ~ T06-C54) ---');

  // Ensure Scope A and Scope B both have active entities
  dbClient.setSessionScope('scope_a');
  const planInA = (await dbClient.fetchAll('scope_a')).plans[0];

  dbClient.setSessionScope('scope_b');
  const planInB = (await dbClient.fetchAll('scope_b')).plans[0];

  // T06-C49: A 범위에서 B 자료를 직접 읽는 요청은 서버가 거부한다.
  dbClient.setSessionScope('scope_a');
  let c49Rejected = false;
  try {
    await dbClient.fetchAll('scope_b');
  } catch (err) {
    c49Rejected = (err.status === 403 || (err.message && err.message.includes('Forbidden')));
  }
  assert(c49Rejected, 'T06-C49: Server strictly rejected direct read of Scope B from Scope A (HTTP 403)');

  // T06-C50: A 범위에서 B 자료를 직접 고치는 요청은 서버가 거부한다.
  dbClient.setSessionScope('scope_a');
  let c50Rejected = false;
  try {
    await dbClient.updatePlan(planInB.id, { title: 'Hacked by A' });
  } catch (err) {
    c50Rejected = true;
  }
  dbClient.setSessionScope('scope_b');
  const scopeBPlanAfterTamper = (await dbClient.fetchAll('scope_b')).plans.find(p => p.id === planInB.id);
  assert(c50Rejected && scopeBPlanAfterTamper.title !== 'Hacked by A', 'T06-C50: Server strictly rejected modifying Scope B plan from Scope A (DB unchanged)');

  // T06-C51: A 범위에서 B 자료를 직접 지우는 요청은 서버가 거부한다.
  dbClient.setSessionScope('scope_a');
  let c51Rejected = false;
  try {
    await dbClient.deletePlan(planInB.id);
  } catch (err) {
    c51Rejected = true;
  }
  dbClient.setSessionScope('scope_b');
  const scopeBPlanAfterDeleteAttempt = (await dbClient.fetchAll('scope_b')).plans.find(p => p.id === planInB.id);
  assert(c51Rejected && Boolean(scopeBPlanAfterDeleteAttempt), 'T06-C51: Server strictly rejected deleting Scope B plan from Scope A (DB intact)');

  // T06-C52: B 범위에서 A 자료를 직접 읽는 요청은 서버가 거부한다.
  dbClient.setSessionScope('scope_b');
  let c52Rejected = false;
  try {
    await dbClient.fetchAll('scope_a');
  } catch (err) {
    c52Rejected = (err.status === 403 || (err.message && err.message.includes('Forbidden')));
  }
  assert(c52Rejected, 'T06-C52: Server strictly rejected direct read of Scope A from Scope B (HTTP 403)');

  // T06-C53: B 범위에서 A 자료를 직접 고치는 요청은 서버가 거부한다.
  dbClient.setSessionScope('scope_b');
  let c53Rejected = false;
  try {
    await dbClient.updatePlan(planInA.id, { title: 'Hacked by B' });
  } catch (err) {
    c53Rejected = true;
  }
  dbClient.setSessionScope('scope_a');
  const scopeAPlanAfterTamper = (await dbClient.fetchAll('scope_a')).plans.find(p => p.id === planInA.id);
  assert(c53Rejected && scopeAPlanAfterTamper.title !== 'Hacked by B', 'T06-C53: Server strictly rejected modifying Scope A plan from Scope B (DB unchanged)');

  // T06-C54: B 범위에서 A 자료를 직접 지우는 요청은 서버가 거부한다.
  dbClient.setSessionScope('scope_b');
  let c54Rejected = false;
  try {
    await dbClient.deletePlan(planInA.id);
  } catch (err) {
    c54Rejected = true;
  }
  dbClient.setSessionScope('scope_a');
  const scopeAPlanAfterDeleteAttempt = (await dbClient.fetchAll('scope_a')).plans.find(p => p.id === planInA.id);
  assert(c54Rejected && Boolean(scopeAPlanAfterDeleteAttempt), 'T06-C54: Server strictly rejected deleting Scope A plan from Scope B (DB intact)');

  // Cross-Scope Child Entity Operations (ToDos & See Reviews)
  dbClient.setSessionScope('scope_b');
  const todoInB = (await dbClient.fetchAll('scope_b')).todos[0];
  dbClient.setSessionScope('scope_a');
  let cTodoUpdateRejected = false;
  try {
    await dbClient.updateTodo(todoInB.id, { title: 'Cross Scope Hack' });
  } catch (err) {
    cTodoUpdateRejected = true;
  }
  assert(cTodoUpdateRejected, 'Server strictly rejected modifying Scope B ToDo from Scope A');

  let cTodoDeleteRejected = false;
  try {
    await dbClient.deleteTodo(todoInB.id);
  } catch (err) {
    cTodoDeleteRejected = true;
  }
  assert(cTodoDeleteRejected, 'Server strictly rejected deleting Scope B ToDo from Scope A');

  let cSeeReviewRejected = false;
  try {
    await dbClient.createSeeReview({
      plan_id: planInB.id,
      review_date: '2026-08-28',
      planned_count: 1,
      completed_count: 1,
      delayed_count: 0,
      blocked_count: 0,
      time_delta_minutes: 0,
      adjustment_insight: 'Cross scope review attempt'
    });
  } catch (err) {
    cSeeReviewRejected = true;
  }
  assert(cSeeReviewRejected, 'Server strictly rejected creating See Review for Scope B plan from Scope A');

  // Cascade Deletion Integrity Test (Zero Orphaned Records)
  dbClient.setSessionScope('scope_a');
  const cascadePlan = await dbClient.createPlan({
    title: 'Cascade Test Plan',
    period_start: '2026-08-28',
    period_end: '2026-08-28',
    priority: 'medium',
    estimated_hours: 60,
    success_criteria: 'Testing cascade cleanup'
  });
  await dbClient.updatePlan(cascadePlan.id, { title: 'Cascade Test Plan v2', revision_reason: 'Testing history trigger' });
  const cascadeTodo = await dbClient.createTodo({
    plan_id: cascadePlan.id,
    title: 'Cascade Child ToDo',
    due_date: '2026-08-28',
    priority: 'low',
    estimated_minutes: 30,
    tags: ['cascade']
  });
  await dbClient.addDoLog(cascadeTodo.id, {
    execution_start: '2026-08-28T09:00:00Z',
    execution_end: '2026-08-28T09:30:00Z',
    actual_minutes: 30,
    blocked_reason: ''
  });
  await dbClient.createSeeReview({
    plan_id: cascadePlan.id,
    review_date: '2026-08-28',
    planned_count: 1,
    completed_count: 1,
    delayed_count: 0,
    blocked_count: 0,
    time_delta_minutes: 0,
    adjustment_insight: 'Cascade review test'
  });
  // Now delete the plan
  await dbClient.deletePlan(cascadePlan.id);
  const scopeADataAfterCascade = await dbClient.fetchAll('scope_a');
  const orphanPlans = scopeADataAfterCascade.plans.filter(p => p.id === cascadePlan.id);
  const orphanHistories = scopeADataAfterCascade.plan_histories.filter(h => h.plan_id === cascadePlan.id);
  const orphanTodos = scopeADataAfterCascade.todos.filter(t => t.plan_id === cascadePlan.id);
  const orphanLogs = scopeADataAfterCascade.do_logs.filter(l => l.todo_id === cascadeTodo.id);
  const orphanReviews = scopeADataAfterCascade.see_reviews.filter(r => r.plan_id === cascadePlan.id);
  assert(
    orphanPlans.length === 0 &&
    orphanHistories.length === 0 &&
    orphanTodos.length === 0 &&
    orphanLogs.length === 0 &&
    orphanReviews.length === 0,
    'Cascade deletion removed all linked histories, todos, do_logs, and reviews (0 orphans)'
  );

  // --- 4b. PLAN VS DO ESTIMATED DURATION CONSTRAINT TESTS ---
  console.log('\n--- [4b] Plan vs Do Estimated Duration & Date Boundary Tests ---');
  
  // 1. Create a 120 min plan
  const budgetPlan = await dbClient.createPlan({
    title: 'Budget Test Plan',
    period_start: '2026-08-28',
    period_end: '2026-08-28',
    priority: 'high',
    estimated_hours: 120,
    success_criteria: 'Test time constraints'
  });

  // ToDo Due Date Exceeding Plan Period End Rejection Test
  let dueDateExceedBlocked = false;
  try {
    await dbClient.createTodo({
      plan_id: budgetPlan.id,
      title: 'Due Date Exceeding Task',
      due_date: '2026-08-30', // Later than Plan end: 2026-08-28
      priority: 'high',
      estimated_minutes: 30,
      tags: ['test']
    });
  } catch (err) {
    dueDateExceedBlocked = true;
  }
  assert(dueDateExceedBlocked, 'Creating ToDo with due date later than Plan end date was strictly blocked');

  // 2. Add ToDo 1 (60 min) - should succeed (60 <= 120)
  const todoValid1 = await dbClient.createTodo({
    plan_id: budgetPlan.id,
    title: 'Valid Task 1',
    due_date: '2026-08-28',
    priority: 'medium',
    estimated_minutes: 60,
    tags: ['test']
  });
  assert(todoValid1 && todoValid1.id, 'Adding ToDo within plan time budget succeeded (60m <= 120m)');

  // 3. Try adding ToDo 2 (70 min, total 130m > 120m) - must be rejected!
  let exceededCreateBlocked = false;
  try {
    await dbClient.createTodo({
      plan_id: budgetPlan.id,
      title: 'Exceeding Task',
      due_date: '2026-08-28',
      priority: 'high',
      estimated_minutes: 70,
      tags: ['test']
    });
  } catch (err) {
    exceededCreateBlocked = true;
  }
  assert(exceededCreateBlocked, 'Adding ToDo exceeding plan budget (130m > 120m) was strictly blocked');

  // 4. Add ToDo 2 (50 min, total 110m <= 120m) - should succeed
  const todoValid2 = await dbClient.createTodo({
    plan_id: budgetPlan.id,
    title: 'Valid Task 2',
    due_date: '2026-08-28',
    priority: 'low',
    estimated_minutes: 50,
    tags: ['test']
  });
  assert(todoValid2 && todoValid2.id, 'Adding second ToDo within remaining budget succeeded (110m <= 120m)');

  // 5. Try updating ToDo 2 to 65 min (total 125m > 120m) - must be rejected!
  let exceededUpdateBlocked = false;
  try {
    await dbClient.updateTodo(todoValid2.id, {
      estimated_minutes: 65
    });
  } catch (err) {
    exceededUpdateBlocked = true;
  }
  assert(exceededUpdateBlocked, 'Updating ToDo duration to exceed plan budget (125m > 120m) was strictly blocked');

  // 6. Try updating Plan budget to 60 min (60 min < child total 110 min) - must be rejected!
  let planUnderflowBlocked = false;
  try {
    await dbClient.updatePlan(budgetPlan.id, {
      estimated_hours: 60,
      revision_reason: 'Testing reduction'
    });
  } catch (err) {
    planUnderflowBlocked = true;
  }
  assert(planUnderflowBlocked, 'Reducing Plan budget below child ToDos sum (60m < 110m) was strictly blocked');

  // 7. Updating Plan budget to 180 min (180 min >= 110 min) - should succeed!
  const expandedPlan = await dbClient.updatePlan(budgetPlan.id, {
    estimated_hours: 180,
    revision_reason: 'Expanding budget'
  });
  assert(Number(expandedPlan.estimated_hours) === 180, 'Expanding Plan budget (180m >= 110m) succeeded');

  // 8. Creating Plan with 0 or negative minutes must be strictly blocked
  let zeroPlanBlocked = false;
  try {
    await dbClient.createPlan({
      title: 'Zero Plan',
      period_start: '2026-08-28',
      period_end: '2026-08-28',
      priority: 'low',
      estimated_hours: 0,
      success_criteria: 'Zero time test'
    });
  } catch (err) {
    zeroPlanBlocked = true;
  }
  assert(zeroPlanBlocked, 'Creating Plan with 0 minutes was strictly blocked');

  let negPlanBlocked = false;
  try {
    await dbClient.createPlan({
      title: 'Negative Plan',
      period_start: '2026-08-28',
      period_end: '2026-08-28',
      priority: 'low',
      estimated_hours: -60,
      success_criteria: 'Negative time test'
    });
  } catch (err) {
    negPlanBlocked = true;
  }
  assert(negPlanBlocked, 'Creating Plan with negative minutes was strictly blocked');

  // 9. Creating ToDo with 0 or negative minutes must be strictly blocked
  let zeroTodoBlocked = false;
  try {
    await dbClient.createTodo({
      plan_id: expandedPlan.id,
      title: 'Zero Task',
      due_date: '2026-08-28',
      priority: 'low',
      estimated_minutes: 0,
      tags: ['test']
    });
  } catch (err) {
    zeroTodoBlocked = true;
  }
  assert(zeroTodoBlocked, 'Creating ToDo with 0 minutes was strictly blocked');

  let negTodoBlocked = false;
  try {
    await dbClient.createTodo({
      plan_id: expandedPlan.id,
      title: 'Negative Task',
      due_date: '2026-08-28',
      priority: 'low',
      estimated_minutes: -30,
      tags: ['test']
    });
  } catch (err) {
    negTodoBlocked = true;
  }
  assert(negTodoBlocked, 'Creating ToDo with negative minutes was strictly blocked');

  // 10. Completing ToDo with 0 or negative actual minutes must be strictly blocked
  let zeroLogBlocked = false;
  try {
    await dbClient.completeTodoIdempotent(todoValid1.id, {
      execution_start: '2026-08-28T10:00:00Z',
      execution_end: '2026-08-28T10:00:00Z',
      actual_minutes: 0,
      blocked_reason: ''
    }, crypto.randomUUID());
  } catch (err) {
    zeroLogBlocked = true;
  }
  assert(zeroLogBlocked, 'Logging completion with 0 actual minutes was strictly blocked');

  // 11. Adding Do Log (Save only) with 0 or negative actual minutes must be strictly blocked
  let zeroAddLogBlocked = false;
  try {
    await dbClient.addDoLog(todoValid1.id, {
      execution_start: '2026-08-28T10:00:00Z',
      execution_end: '2026-08-28T10:00:00Z',
      actual_minutes: 0,
      blocked_reason: ''
    });
  } catch (err) {
    zeroAddLogBlocked = true;
  }
  assert(zeroAddLogBlocked, 'Adding Do Log with 0 actual minutes was strictly blocked');

  // --- 5. POSTGRESQL PGCRYPTO & AT-REST ENCRYPTION TESTS ---
  console.log('\n--- [5] PostgreSQL pgcrypto & At-Rest Encryption Tests (T06-C58 Compliant) ---');

  // 1. Verify schema.sql enables pgcrypto extension and defines encryption functions
  const schemaPath = path.resolve('schema.sql');
  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  assert(schemaContent.includes('CREATE EXTENSION IF NOT EXISTS pgcrypto;'), 'schema.sql enables pgcrypto extension');
  assert(schemaContent.includes('pgp_sym_encrypt') && schemaContent.includes('pgp_sym_decrypt'), 'schema.sql defines pgp_sym_encrypt and pgp_sym_decrypt functions');

  // 2. Encryption and Decryption Roundtrip without user passphrase
  const sampleSecret = 'This is a deeply personal diary reflection with private thoughts.';
  const encrypted = await encryptText(sampleSecret);
  assert(isEncrypted(encrypted), 'Encrypted string begins with armored enc:v1: prefix');
  assert(encrypted !== sampleSecret, 'Encrypted string is distinct ciphertext');

  const decrypted = await decryptText(encrypted);
  assert(decrypted === sampleSecret, 'Decrypted text matches original plaintext exactly without user prompts');

  // 3. Empty / Whitespace-Only String Guard (Never Encrypted to avoid metric skew)
  const emptyEnc = await encryptText('');
  assert(emptyEnc === '', 'Empty string is preserved as empty string');
  const wsEnc = await encryptText('   ');
  assert(wsEnc === '   ', 'Whitespace string is preserved without encryption');

  // 4. Plaintext Transparent Fallback (Non-prefixed strings return as-is)
  const legacyPlain = 'Legacy non-encrypted criteria';
  const fallbackResult = await decryptText(legacyPlain);
  assert(fallbackResult === legacyPlain, 'Non-prefixed string returned as-is via transparent fallback');

  // 5. Transparent at-rest persistence check via dbClient
  const createdPlan = await dbClient.createPlan({
    title: 'Secret Strategic Launch',
    period_start: today,
    period_end: today,
    priority: 'high',
    success_criteria: 'Confidential target criteria for Q4',
    estimated_hours: 8.0,
    status: 'active'
  });
  
  // Verify return value is cleartext in memory
  assert(createdPlan.success_criteria === 'Confidential target criteria for Q4', 'In-memory return value is decrypted plaintext');

  // Check underlying storage representation to verify it is encrypted at rest
  const rawStorageKey = CONFIG.STORAGE_KEYS.DB_STORE_PREFIX + 'scope_a';
  const rawStorageData = JSON.parse(global.localStorage.getItem(rawStorageKey));
  const storedPlan = rawStorageData.plans.find(p => p.id === createdPlan.id);
  assert(isEncrypted(storedPlan.success_criteria), 'Database record stores encrypted armored ciphertext (enc:v1:...) at rest');

  // --- 6. REACTIVE STATE & METRICS OVERRUN TESTS ---
  console.log('\n--- [6] Reactive State & Metrics Overrun Tests ---');

  // Test Plan filter dropdown single selection
  appState.state.plans = [
    { id: 'plan-1', title: 'Plan 1', priority: 'high' },
    { id: 'plan-2', title: 'Plan 2', priority: 'medium' }
  ];
  appState.setFilters({ planId: 'plan-1' });
  const filteredSinglePlan = appState.getFilteredPlans();
  assert(filteredSinglePlan.length === 1 && filteredSinglePlan[0].id === 'plan-1', 'Selecting a plan in dropdown filters Plan column to show only that plan');

  appState.setFilters({ planId: '' });
  const allFilteredPlans = appState.getFilteredPlans();
  assert(allFilteredPlans.length === 2, 'Selecting All Plans in dropdown shows all plans');

  // Test Time Overrun counted in delayedCount
  appState.state.todos = [
    { id: 'todo-overrun', plan_id: 'plan-1', title: 'Overrun Task', due_date: '2099-01-01', estimated_minutes: 30, is_completed: true }
  ];
  appState.state.do_logs = [
    { id: 'log-overrun', todo_id: 'todo-overrun', actual_minutes: 45, blocked_reason: '' }
  ];
  const overrunMetrics = appState.getKSTMetrics('plan-1');
  assert(overrunMetrics.delayedCount === 1, 'Task with actual minutes > estimated minutes is counted in delayedCount (Time Overrun)');

  console.log('\n====================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('====================================================\n');
}

runAllTests().catch(err => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
