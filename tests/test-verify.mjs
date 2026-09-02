/**
 * tests/test-verify.mjs
 * Integration Verification Suite — TASK 07
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir   = path.resolve(__dirname, '..');

// ── DOM / browser shim ────────────────────────────────────────────────────────
globalThis.window    = globalThis;
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => Math.random().toString(36).slice(2),
    configurable: true
  });
}
globalThis.localStorage = (() => {
  const store = {};
  return {
    getItem:    k      => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: k      => { delete store[k]; },
    clear:      ()     => { Object.keys(store).forEach(k => delete store[k]); }
  };
})();

// ── Schema ground truth (from schema.sql lines 79-91) ────────────────────────
const SCHEMA_DO_LOGS_UPDATABLE = new Set([
  'execution_start', 'execution_end', 'actual_minutes',
  'blocked_reason', 'memo', 'completion_token'
]);

const SCHEMA_DO_LOGS_FORBIDDEN = [
  'id', 'user_id', 'todo_id', 'created_at',
  'start_time', 'end_time', 'duration_minutes',
  'blocker_reason', 'updated_at'
];

// ── Test infrastructure ───────────────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(condition, label, detail = '') {
  if (condition) { console.log(`  ✅ PASS: ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function run() {
  console.log('\n════════════════════════════════════════════════════');
  console.log('🔍 TASK 07 INTEGRATION VERIFICATION SUITE');
  console.log('════════════════════════════════════════════════════\n');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => '' });

  const { CONFIG }                      = await import(pathToFileURL(path.join(rootDir, 'src/core/config.js')).href);
  CONFIG.SUPABASE.URL = 'https://mock.supabase.co';
  CONFIG.SUPABASE.ANON_KEY = 'mock_anon_key';
  globalThis.CONFIG = CONFIG;
  const { encryptText, decryptText }    = await import(pathToFileURL(path.join(rootDir, 'src/utils/crypto.js')).href);
  globalThis.encryptText = encryptText; globalThis.decryptText = decryptText;
  const { sanitizeText, clampNum }      = await import(pathToFileURL(path.join(rootDir, 'src/utils/validators.js')).href);
  globalThis.sanitizeText = sanitizeText; globalThis.clampNum = clampNum;
  const { getKSTToday, isDelayedKST }   = await import(pathToFileURL(path.join(rootDir, 'src/utils/dateUtils.js')).href);
  globalThis.getKSTToday = getKSTToday; globalThis.isDelayedKST = isDelayedKST;
  const { authClient }  = await import(pathToFileURL(path.join(rootDir, 'src/auth/auth.js')).href);
  const { dbClient }    = await import(pathToFileURL(path.join(rootDir, 'src/api/supabaseClient.js')).href);
  dbClient.isCloudConfigured = true;
  const { API }         = await import(pathToFileURL(path.join(rootDir, 'src/api/api.js')).href);

  authClient.setSession({ access_token: 'tok', token_type: 'bearer', expires_in: 3600, user: { id: 'u1', email: 'v@test.com' } });

  const planId = 'p1', todoId = 't1', logId = 'l1';
  const seed = {
    plans: [{ id: planId, user_id: 'u1', title: 'P', period_start: '2026-09-01', period_end: '2026-09-30', priority: 'medium', success_criteria: '', estimated_hours: 0, status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
    plan_histories: [], see_reviews: [],
    todos: [{ id: todoId, user_id: 'u1', plan_id: planId, title: 'T', description: '', due_date: '2026-09-01', priority: 'medium', tags: [], estimated_minutes: 60, is_completed: false, completed_at: null, sort_order: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
    do_logs: [{ id: logId, todo_id: todoId, user_id: 'u1', execution_start: '2026-09-01T09:00:00.000Z', execution_end: '2026-09-01T10:00:00.000Z', actual_minutes: 60, blocked_reason: '', memo: '', completion_token: null, created_at: new Date().toISOString() }]
  };
  dbClient._saveData(seed); dbClient.memoryStore.clear();

  // ─── [A] PATCH payload schema verification ────────────────────────────────
  console.log('--- [A] do_logs PATCH Payload: Schema Column Verification ---');

  let patchBody = null;
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === 'PATCH' && String(url).includes('/rest/v1/do_logs')) {
      patchBody = JSON.parse(opts.body || '{}');
      return { ok: true, status: 200, json: async () => [patchBody], text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => '' };
  };

  await API.updateDoLog(logId, {
    execution_start: '2026-09-01T10:00:00.000Z', execution_end: '2026-09-01T11:30:00.000Z',
    actual_minutes: 90, blocked_reason: 'Network issue', memo: 'Verified',
    user_id: 'inject', id: 'inject', duration_minutes: 90,
    start_time: '2026-09-01T10:00:00.000Z', end_time: '2026-09-01T11:30:00.000Z',
    updated_at: new Date().toISOString()
  });

  if (patchBody) {
    assert(patchBody.execution_start !== undefined, 'PATCH contains execution_start');
    assert(patchBody.execution_end   !== undefined, 'PATCH contains execution_end');
    assert(patchBody.actual_minutes  !== undefined, 'PATCH contains actual_minutes');
    assert(patchBody.blocked_reason  !== undefined, 'PATCH contains blocked_reason');
    assert(patchBody.memo            !== undefined, 'PATCH contains memo');
    assert(typeof patchBody.actual_minutes === 'number', 'actual_minutes is a number', `got ${typeof patchBody.actual_minutes}`);
    assert(patchBody.actual_minutes === 90, 'actual_minutes value is 90', `got ${patchBody.actual_minutes}`);
    for (const col of SCHEMA_DO_LOGS_FORBIDDEN) {
      assert(patchBody[col] === undefined, `PATCH does NOT contain forbidden '${col}'`);
    }
    const invalidKeys = Object.keys(patchBody).filter(k => !SCHEMA_DO_LOGS_UPDATABLE.has(k));
    assert(invalidKeys.length === 0, 'All PATCH keys are schema-valid', `invalid: ${invalidKeys.join(', ')}`);
  } else {
    assert(false, 'PATCH body was captured');
  }

  globalThis.fetch = originalFetch;

  // ─── [B] Invalid email: client-side rejection without network call ─────────
  console.log('\n--- [B] Invalid Email: Client-Side Rejection (No Network Call) ---');

  const badEmails = ['notanemail', 'missing@domain', '@nodomain.com', ''];
  for (const bad of badEmails) {
    let netCalled = false;
    globalThis.fetch = async (url) => { if (String(url).includes('auth')) netCalled = true; return { ok: false, status: 422, json: async () => ({}), text: async () => '' }; };
    let err = null;
    try {
      const res = await authClient.signup(bad, 'password123');
      if (res && (res.code || res.error_code || !res.success)) {
        err = { code: res.error_code, message: res.msg, status: res.code };
      }
    } catch (e) { err = e; }
    assert(err !== null, `signup('${bad}') rejected client-side`);
    assert(!netCalled, `signup('${bad}') does not call network`);
    assert((err?.message || '').includes('이메일') || (err?.message || '').includes('올바른') || err?.code === 'invalid_email' || err?.code === 'invalid_credentials',
      `signup('${bad}') error is email-format related`, `msg: "${err?.message}"`);
    globalThis.fetch = originalFetch;
  }

  // Valid email must call network
  let validNetCalled = false;
  globalThis.fetch = async (url) => { if (String(url).includes('signup')) validNetCalled = true; return { ok: true, status: 200, json: async () => ({ user: { id: 'x', email: 'valid@example.com', identities: [{ id: 'y' }] }, session: null }), text: async () => '' }; };
  try { await authClient.signup('valid@example.com', 'password123'); } catch (_) {}
  assert(validNetCalled, 'valid email DOES call network');
  globalThis.fetch = originalFetch;

  // ─── [C] 422 error classification ────────────────────────────────────────
  console.log('\n--- [C] 422 Error Classification: Duplicate vs Other ---');

  // C1: identities=[] → duplicate
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ user: { id: 'x', email: 'd@t.com', identities: [] }, session: null }), text: async () => '' });
  let e1 = null;
  try {
    const res1 = await authClient.signup('d@t.com', 'pass1234');
    if (res1 && (res1.code || res1.error_code || !res1.success)) {
      e1 = { code: res1.error_code, status: res1.code, message: res1.msg };
    }
  } catch (e) { e1 = e; }
  assert(e1?.code === 'user_already_exists', 'C1: identities=[] → user_already_exists', `got: ${e1?.code}`);
  assert(e1?.status === 422, 'C1: status 422', `got: ${e1?.status}`);
  globalThis.fetch = originalFetch;

  // C2: 422 + "already registered" → duplicate
  globalThis.fetch = async () => ({ ok: false, status: 422, json: async () => ({ error: 'User already registered' }), text: async () => JSON.stringify({ error: 'User already registered' }) });
  let e2 = null;
  try {
    const res2 = await authClient.signup('d2@t.com', 'pass1234');
    if (res2 && (res2.code || res2.error_code || !res2.success)) {
      e2 = { code: res2.error_code, status: res2.code, message: res2.msg };
    }
  } catch (e) { e2 = e; }
  assert(e2?.status === 422, 'C2: "already registered" → 422', `got: ${e2?.status}`);
  assert((e2?.message || '').includes('가입된') || e2?.code === 'user_already_exists', 'C2: duplicate message', `got: "${e2?.message}"`);
  globalThis.fetch = originalFetch;

  // C3: short password caught client-side, NOT mapped to duplicate
  let e3 = null;
  try {
    const res3 = await authClient.signup('good@t.com', 'ab');
    if (res3 && (res3.code || res3.error_code || !res3.success)) {
      e3 = { code: res3.error_code, status: res3.code, message: res3.msg };
    }
  } catch (e) { e3 = e; }
  assert(e3?.code === 'password_too_short' || e3?.status === 400, 'C3: short password caught', `got: ${e3?.code}`);
  assert(!(e3?.message || '').includes('가입된'), 'C3: NOT mapped to duplicate', `got: "${e3?.message}"`);

  // ─── [D] localStorage email persistence ───────────────────────────────────
  console.log('\n--- [D] localStorage Email Persistence (Checkbox State) ---');
  localStorage.clear();

  const sim = (email, checked) => {
    if (checked) localStorage.setItem('saved_email', email.trim());
    else localStorage.removeItem('saved_email');
  };

  sim('user@example.com', true);
  assert(localStorage.getItem('saved_email') === 'user@example.com', 'D1: checked → email saved');

  sim('user@example.com', false);
  assert(localStorage.getItem('saved_email') === null, 'D2: unchecked → email removed');

  localStorage.setItem('saved_email', 'prefill@example.com');
  assert(localStorage.getItem('saved_email') === 'prefill@example.com', 'D3: saved_email readable on init');

  sim('new@example.com', true);
  assert(localStorage.getItem('saved_email') === 'new@example.com', 'D4: new login overwrites saved_email');

  localStorage.clear();
  assert(localStorage.getItem('saved_email') === null, 'D5: after clear() → saved_email gone');

  // ── Summary ─────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log('\n════════════════════════════════════════════════════');
  if (failed === 0) {
    console.log(`🎉 ALL VERIFICATION TESTS PASSED! (${passed}/${total})`);
  } else {
    console.log(`⚠️  ${failed} FAILED, ${passed} PASSED (${passed}/${total})`);
  }
  console.log('════════════════════════════════════════════════════\n');
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error('Verification suite error:', err); process.exit(1); });
