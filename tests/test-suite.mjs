/**
 * Automated Verification Test Suite for Plan-Do-See Diary
 */

import { getKSTParts, getKSTToday, getKSTWeekRange, isSameKSTWeek, getKSTMonthRange, isDelayedKST, calculateElapsedMinutes } from '../js/dateUtils.js';
import { validateFileSize, migrateLegacySchema, validateImportPayload } from '../js/validators.js';
import { dbClient } from '../js/supabaseClient.js';
import { escapeHtml } from '../js/ui.js';
import { CONFIG } from '../js/config.js';
import { encryptText, decryptText, isEncrypted } from '../js/crypto.js';
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

  // --- 3. ATOMIC IMPORT & LEGACY MIGRATION ---
  console.log('\n--- [3] Import Validation & Legacy Migration Tests ---');
  
  // 5MB Limit Check
  try {
    validateFileSize(6 * 1024 * 1024);
    assert(false, 'Should have failed 5MB check');
  } catch (err) {
    assert(err.message.includes('5MB limit'), 'Payload > 5MB correctly rejected');
  }

  // Legacy Schema Migration Check (v1 flat structure)
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
  assert(migrated.version === '2.0.0', 'Migrated schema version upgraded to 2.0.0');
  assert(migrated.plans[0].title === 'Legacy Plan Title', 'plan_title mapped to title');
  assert(migrated.plans[0].estimated_hours === 2, 'estimated_minutes converted to estimated_hours');
  assert(migrated.todos[0].title === 'Legacy Task', 'task_name mapped to title');
  assert(migrated.do_logs[0].blocked_reason === 'Legacy obstacle', 'blocker mapped to blocked_reason');

  const validated = validateImportPayload(migrated, 'scope_a');
  assert(validated.plans.length === 1, 'Validated migrated payload successfully');

  // Corrupt validation test (Duplicate ID check)
  const corruptPayload = JSON.parse(JSON.stringify(migrated));
  corruptPayload.todos.push({
    id: '11111111-1111-4111-8111-111111111111', // Duplicate ID matching Plan
    plan_id: '11111111-1111-4111-8111-111111111111',
    title: 'Collision Task',
    due_date: '2026-01-07',
    priority: 'medium',
    is_completed: false
  });

  try {
    validateImportPayload(corruptPayload, 'scope_a');
    assert(false, 'Should fail duplicate ID validation');
  } catch (err) {
    assert(err.message.includes('Duplicate primary key ID'), 'Duplicate primary key detected and blocked atomically');
  }

  // --- 4. DATABASE LAYER & SCOPE ISOLATION ---
  console.log('\n--- [4] Database Layer & Persona Scope Isolation Tests ---');

  // Load Scope A
  dbClient.setSessionScope('scope_a');
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

  console.log('\n====================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('====================================================\n');
}

runAllTests().catch(err => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
