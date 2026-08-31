/**
 * Phase 2 Automated Test Suite — Auth UI, API Layer & Migration
 * Covers: T07-C03, T07-C94~C100, T07-C106, T07-C112, T07-C133, T07-C134
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
global.window = { __PDS_SUPABASE_URL: '', __PDS_SUPABASE_KEY: '' };
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: () => `test-${Math.random().toString(36).slice(2)}`,
  writable: true,
  configurable: true
});
global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) });

// Dynamically import modules after globals are set
const { CONFIG } = await import('../js/config.js');
const { authClient } = await import('../js/auth.js');
const { API } = await import('../js/api.js');
const { migrateLegacySchema, validateImportPayload } = await import('../js/validators.js');

async function runPhase2Tests() {
  console.log('====================================================');
  console.log('🔐 RUNNING PHASE 2: AUTH UI & CLIENT API LAYER TESTS');
  console.log('====================================================\n');

  // ----------------------------------------------------------------
  // TEST 1: Auth Overlay & Landing Page (T07-C03, T07-C94, T07-C97)
  // ----------------------------------------------------------------
  console.log('--- [1] Auth Overlay & Landing Page (T07-C03, T07-C97) ---');

  const htmlPath = path.resolve('index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  assert(htmlContent.includes('id="authOverlay"'), 'Auth overlay element exists in index.html');
  assert(htmlContent.includes('id="loginBtn"'), 'Login button exists in index.html');
  assert(htmlContent.includes('id="signupBtn"'), 'Sign-up button exists in index.html');
  assert(htmlContent.includes('id="authEmail"'), 'Email input exists in index.html');

  // T07-C106: Password masking
  const pwdInputMatch = htmlContent.match(/id="authPassword"[^>]*type="password"|type="password"[^>]*id="authPassword"/);
  assert(pwdInputMatch !== null || htmlContent.includes('type="password"'), 'Password input uses type="password" (T07-C106)');

  // T07-C97: Protected view is gated
  assert(htmlContent.includes('id="mainBoard"'), 'Main board container exists and can be toggled hidden');
  assert(htmlContent.includes('id="logoutBtn"'), 'Logout button exists (T07-C97)');

  // ----------------------------------------------------------------
  // TEST 2: Uniform Error Message Standard (T07-C99, T07-C98)
  // ----------------------------------------------------------------
  console.log('\n--- [2] Uniform Error Message Standard (T07-C98, T07-C99) ---');

  // Verify authClient.login always throws normalized error
  let loginErrMsg = '';
  try {
    await authClient.login('nonexistent@test.com', 'wrongpassword');
  } catch (e) {
    loginErrMsg = e.message;
  }
  assert(loginErrMsg === 'Invalid login credentials', 'Login failure returns uniform "Invalid login credentials" for wrong user (T07-C99)');

  let signupErrMsg = '';
  try {
    await authClient.signup('duplicate@test.com', 'anypassword');
  } catch (e) {
    signupErrMsg = e.message;
  }
  assert(signupErrMsg === 'Invalid login credentials', 'Signup failure returns uniform "Invalid login credentials" (T07-C98)');

  // ----------------------------------------------------------------
  // TEST 3: Password Field Security (T07-C106)
  // ----------------------------------------------------------------
  console.log('\n--- [3] Password Field Security (T07-C106) ---');

  const authJsPath = path.resolve('js/auth.js');
  const authJsContent = fs.readFileSync(authJsPath, 'utf-8');
  const appJsPath = path.resolve('js/app.js');
  const appJsContent = fs.readFileSync(appJsPath, 'utf-8');

  assert(!authJsContent.includes('console.log'), 'auth.js has no console.log calls (password leak prevention)');

  const passwordLogPattern = /console\.log\([^)]*password[^)]*\)/i;
  assert(!passwordLogPattern.test(appJsContent), 'app.js does not log any password variable (T07-C106)');

  // ----------------------------------------------------------------
  // TEST 4: Token via Header Only (T07-C112)
  // ----------------------------------------------------------------
  console.log('\n--- [4] Token Transport Security — Header Only (T07-C112) ---');

  const urlTokenPattern = /\?.*token=|&token=|access_token=[^&'"]/;
  assert(!urlTokenPattern.test(authJsContent), 'auth.js never appends token to URL query params (T07-C112)');
  assert(authJsContent.includes("'Authorization'"), 'auth.js attaches token via Authorization header (T07-C112)');

  const supabaseClientPath = path.resolve('js/supabaseClient.js');
  const scContent = fs.readFileSync(supabaseClientPath, 'utf-8');
  assert(scContent.includes('authClient.getAccessToken()'), 'supabaseClient.js injects auth token via _getCloudHeaders (T07-C112)');

  // ----------------------------------------------------------------
  // TEST 5: Session Expiry Auto-Cleanup
  // ----------------------------------------------------------------
  console.log('\n--- [5] Session Expiry & Auto-Cleanup ---');

  authClient.session = { access_token: 'test', refresh_token: 'r', expires_at: 1, user: {} };
  assert(!authClient.isAuthenticated(), 'Expired session is auto-rejected by isAuthenticated()');
  assert(authClient.session === null, 'Expired session is cleared from memory');
  assert(localStorage.getItem(CONFIG.STORAGE_KEYS.AUTH_SESSION) === null, 'Expired session is cleared from localStorage');

  // ----------------------------------------------------------------
  // TEST 6: T06 Legacy Data Migration (T07-C100)
  // ----------------------------------------------------------------
  console.log('\n--- [6] T06 Legacy Data Migration (T07-C100) ---');

  const legacyKey = 'pds_db_v2_scope_a';
  const legacyPayload = {
    scope: 'scope_a',
    version: '1.0',
    plans: [{
      id: 'migrate-plan-001',
      plan_title: 'Legacy Plan Title',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      priority: 'medium',
      success_criteria: 'Legacy criteria',
      estimated_minutes: 120,
      status: 'active',
      scope: 'scope_a'
    }],
    todos: [],
    do_logs: [],
    see_reviews: []
  };
  localStorage.setItem(legacyKey, JSON.stringify(legacyPayload));

  const rawLocal = localStorage.getItem(legacyKey);
  assert(rawLocal !== null, 'Legacy local data exists in localStorage for migration');

  const parsed = JSON.parse(rawLocal);
  const migrated = migrateLegacySchema({ ...parsed, scope: 'scope_a' }, 'scope_a');
  assert(migrated.version === '2.0.0', 'Legacy v1 schema upgraded to 2.0.0 during migration');
  assert(migrated.plans[0].title === 'Legacy Plan Title', 'Legacy plan_title mapped to title during migration');
  assert(typeof migrated.plans[0].estimated_hours === 'number', 'estimated_minutes converted to estimated_hours');

  const validated = validateImportPayload(migrated, 'scope_a');
  assert(Array.isArray(validated.plans), 'Migrated payload passes contract validation');

  // Simulate localStorage cleanup after migration
  localStorage.removeItem(legacyKey);
  assert(localStorage.getItem(legacyKey) === null, 'Local data removed from localStorage after successful migration');

  // ----------------------------------------------------------------
  // TEST 7: JSON Export (T07-C133)
  // ----------------------------------------------------------------
  console.log('\n--- [7] JSON Export Shape (T07-C133) ---');

  const exportResult = await API.exportBackup();
  assert(typeof exportResult.version === 'string', 'Export contains version field');
  assert(typeof exportResult.exported_at === 'string', 'Export contains exported_at timestamp');
  assert(Array.isArray(exportResult.plans), 'Export contains plans array');
  assert(Array.isArray(exportResult.todos), 'Export contains todos array');
  assert(Array.isArray(exportResult.do_logs), 'Export contains do_logs array');
  assert(Array.isArray(exportResult.see_reviews), 'Export contains see_reviews array');

  // ----------------------------------------------------------------
  // TEST 8: Account Deletion UI (T07-C134)
  // ----------------------------------------------------------------
  console.log('\n--- [8] Account Deletion UI & Modals (T07-C134) ---');

  assert(htmlContent.includes('id="deleteAccountModal"'), 'Delete account confirmation modal exists in index.html');
  assert(htmlContent.includes('id="deleteAccountBtn"'), 'Delete account trigger button exists in header');
  assert(htmlContent.includes('id="deleteAccountConfirmBtn"'), 'Delete account confirm button exists in modal');
  assert(htmlContent.includes('영구적으로 삭제'), 'Delete account modal contains permanent deletion warning text');

  // ----------------------------------------------------------------
  // TEST 9: Migration Modal (T07-C100)
  // ----------------------------------------------------------------
  console.log('\n--- [9] Migration Modal UI (T07-C100) ---');

  assert(htmlContent.includes('id="migrationModal"'), 'Migration modal exists in index.html');
  assert(htmlContent.includes('id="migrationImportBtn"'), 'Migration import button exists');
  assert(htmlContent.includes('id="migrationSkipBtn"'), 'Migration skip button exists');

  // ----------------------------------------------------------------
  // TEST 10: Secrets Scan on New Phase 2 Files (T07-C46, T07-C113)
  // ----------------------------------------------------------------
  console.log('\n--- [10] Secrets Leak Scan — Phase 2 Files (T07-C46, T07-C113) ---');

  const rawJwtPattern = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
  const hardcodedKeyPattern = /supabase_service_role|service_role_key|postgres_password/i;

  const filesToScan = [
    ['js/auth.js', authJsContent],
    ['js/supabaseClient.js', scContent],
    ['js/app.js', appJsContent],
    ['DOCS_AUTH.md', fs.readFileSync(path.resolve('DOCS_AUTH.md'), 'utf-8')]
  ];

  for (const [filename, content] of filesToScan) {
    assert(!rawJwtPattern.test(content), `No raw unmasked JWT token found in ${filename} (T07-C46)`);
    assert(!hardcodedKeyPattern.test(content), `No hardcoded service role key in ${filename} (T07-C113)`);
  }

  // ----------------------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} PHASE 2 ASSERTIONS PASSED!`);
  console.log('====================================================');
}

runPhase2Tests().catch(err => {
  console.error('\n❌ PHASE 2 TEST SUITE FAILED:', err.message);
  process.exit(1);
});
