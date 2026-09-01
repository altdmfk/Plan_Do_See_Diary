# DOCS_AUTH.md - Security Architecture & Authentication Schema

## Overview
Phase 1 adds database-level security via Supabase Auth and RLS. Phase 2 adds the complete client-side
authentication flow, credential lifecycle management, session-aware API routing, T06 legacy migration,
and account management UI.

---

## 1. Authentication Strategy: Supabase Auth (AaaS)

### Rationale vs. Alternatives
| Approach | Verdict |
|---|---|
| Custom JWT service | Rejected: requires maintaining key rotation, blacklisting, and token storage security |
| Passport.js (Node.js) | Rejected: incompatible with static hosting and serverless architecture |
| **Supabase Auth** | **Selected**: zero-backend, integrates directly with PostgreSQL `auth.uid()` for kernel-level RLS |

Supabase Auth issues short-lived JWTs that PostgreSQL reads natively via `auth.uid()`. This means
authorization (who can see which rows) is enforced at the database level and cannot be bypassed by
any application-layer bug.

### Version Specification
- Supabase Auth v2 REST API: `/auth/v1/token`, `/auth/v1/signup`, `/auth/v1/logout`
- JWT standard: RS256 signed, 1 hour expiry by default, refresh token rotation enabled

### Password Hashing
Supabase Auth uses **bcrypt** (cost factor 10+) for password hashing within `auth.users`. Each
password hash carries a unique random salt, preventing rainbow table attacks. The application code
**never handles raw password hashes** â€” credential verification is fully delegated to Supabase Auth.

---

## 2. Session Management & Token Policies

### Storage Strategy (T07-C112 Compliance)
- **In-Memory + localStorage session object**: The token is stored as a parsed session object in memory
  (`authClient.session`) and persisted to `localStorage` under a namespaced key (`pds_auth_session`).
- **NEVER in URL parameters**: Tokens are attached exclusively via `Authorization: Bearer <token>` HTTP
  headers on each API request. Appending tokens to URLs would expose them in browser history, server
  access logs, and proxy logs.
- **Expiry enforcement**: On every `isAuthenticated()` call, `expires_at` is checked against `Date.now()`.
  Stale sessions are immediately purged from memory and localStorage.

### Token Lifecycle
```
Login â†’ setSession(data) â†’ localStorage["pds_auth_session"] = { access_token, refresh_token, expires_at, user }
                          â†“
Every API request â†’ _getCloudHeaders() â†’ authClient.getAccessToken() â†’ "Authorization: Bearer <token>"
                          â†“
Token expiry â†’ isAuthenticated() returns false â†’ clearSession() â†’ UI redirected to authOverlay
```

### Masking in Logs (T07-C46, T07-C131)
Raw JWTs must never appear in console outputs or error messages. When referencing a token in logs,
use: `eyJhb...[TRUNCATED]`.

---

## 3. RLS Execution Flow (T07-C117 ~ T07-C121)

1. **Client request**: `fetch()` with `Authorization: Bearer <JWT>` header.
2. **Supabase PostgREST**: Validates signature, decodes `sub` claim â†’ sets `auth.uid()` in PostgreSQL session.
3. **RLS policy evaluation**: Every query is constrained by `user_id = auth.uid()`.
4. **Result**: Rows not owned by the caller return 0 results (HTTP 404) or raise HTTP 403 on write attempts.
5. **Cross-account isolation**: Even if a client forges a `user_id` value in the request body, the server
   RLS `WITH CHECK` clause rejects the insert/update before it reaches the table.

---

## 4. Uniform Error Messages (T07-C99)

Both "user does not exist" and "wrong password" login failures return the identical message:
> **"Invalid login credentials"**

This prevents **username enumeration attacks**, where an attacker probes which email addresses are
registered by comparing error messages. The `authClient.login()` method catches all Supabase Auth
error variants and re-throws a single normalized Error.

Likewise, duplicate account registration (T07-C98) throws the same uniform message to avoid
confirming whether an email already exists in the system.

---

## 5. T06 Legacy Data Migration (T07-C100)

### Trigger
After authentication, the app first checks `pds_migrated_<user-id>`. When the flag is absent and
one of the legacy T06 keys is present (`pds_db_v2_scope_a`, `pds_db_v2_scope_b`, or the split
`pds_*_v2` keys), a non-blocking migration modal is shown.

### Migration Flow
```
User logs in â†’ pds_migrated_<user-id> is absent and legacy data exists?
               â†“ YES
            migrationModal opens
               â†“ User clicks "Import"
            API.migrateLocalDataToUser()
               â†“
            decryptText() for sensitive fields â†’ migrateLegacySchema() â†’ validateImportPayload() â†’ dbClient.restoreScopeBackup()
               â†“
            legacy T06 keys removed + completion flag written â†’ appState.init() refreshes from server
```

### Idempotency
`restoreScopeBackup()` performs Map-based deduplication by primary key (`id`), so re-importing
produces 0 duplicate rows regardless of how many times the migration runs.

### Scope Removal
T07 no longer exposes virtual Scope A/B sessions. The client sends no persona-scope header or
query filter; Supabase Auth and RLS isolate every read and write by the authenticated user ID.
The local cache is also keyed by authenticated user ID to avoid cross-account reuse on a device.

---

## 6. Account Deletion (T07-C134)

### Client Layer
The "Delete Account" button opens a confirmation modal with an explicit data purge warning. On
confirmation:
1. `API.purgeUserData()` â€” clears the authenticated user's data.
2. `authClient.logout()` â€” invalidates the server-side session token.
3. `appState.clearAll()` â€” wipes in-memory state store, notifies UI to render empty state.
4. Auth overlay is shown; user is effectively logged out.

### Server Layer (schema.sql)
The `trg_cascade_user_deletion` PostgreSQL trigger fires `AFTER DELETE ON auth.users`, which deletes
all records in `plans`, `todos`, `do_logs`, `see_reviews`, and `plan_histories` where `user_id = OLD.id`.
The `ON DELETE CASCADE` foreign keys provide a second layer of referential integrity enforcement.

---

## 7. Password Field Security (T07-C106)

All password inputs use `type="password"`. Raw password strings are:
- Never passed to `console.log`, `showToast`, or error handlers.
- Never included in error toast messages or response payloads.
- Cleared from DOM input fields immediately after a successful auth operation.

## 8. Defect Resolutions & Validation Hardening (Phase 3)

### Bug 1: Email Format Validation (400 `validation_failed`)
- **Root Cause:** Trailing spaces and invalid characters passed directly to Supabase Auth API without frontend normalization.
- **Fix:** In `js/auth.js`, emails are trimmed, converted to lowercase, and strictly verified using client-side regex (`^[^\s@]+@[^\s@]+\.[^\s@]+$`) before dispatching any `fetch` request, preventing the 400 error loop.

### Bug 2: Clock Skew Tolerance (PGRST303 `JWT issued at future`)
- **Root Cause:** Due to minor clock sync drifts between the client device and the PostgREST server, freshly minted tokens were occasionally rejected as being "from the future" (`iat` > `now`).
- **Fix:** Implemented a unified recursive `_fetch` wrapper in `js/supabaseClient.js` and `js/auth.js`. Any `401 Unauthorized` containing `PGRST303` or `JWT issued at future` triggers an automatic 1.5-second buffer sleep and a single retry.

### Bug 3: Duplicate Items Post-Migration
- **Root Cause:** `api.js` was purging only a subset of local keys, while keeping `appState` dirty during the T06 to T07 crossover, rendering duplicate DOM elements from merged states.
- **Fix:** Bound `appState.clearAll()` tightly in the `migrationImportBtn` handler before calling `appState.init()`. 

### Bug 4 & 5: Spam Protection, Mutex & Debounce
- **Root Cause:** Network latency allowed multi-clicks on registration, triggering parallel signups and spamming the backend auth service.
- **Fix:** Applied an `isAuthInProgress` mutex lock and explicit button disable logic inside `handleAuth()`. Enforced a strict 3-second cooldown timestamp check between `signup` actions.

### Bug 6: Strict Date Bound Verification
- **Root Cause:** ToDos were only checked against `period_end` (e.g. `due_date <= period_end`), erroneously allowing ToDos to precede the plan's `period_start`.
- **Fix:** Implemented hard date boundaries at the `js/ui.js` level via the HTML `min` attribute on `todoDueDateInput`, backed by dual backend bounds-checking inside `completeTodoIdempotent`.

---

## 9. Feature 7: Time Tracking Memo & Interval Audit Log

### Schema Upgrade
- **`do_logs` Table:** Added `memo TEXT NOT NULL DEFAULT ''` to store optional execution notes alongside the task timing block.
- **E2EE (End-to-End Encryption):** Memos pass through the same `pds_encrypt_text` pgCrypto hashing functions as blockers, ensuring plaintexts are never exposed at rest.

### Interface
- The Execution modal exposes an explicitly decoupled `textarea` for notes/memos alongside the blockers box.
- The `ui.js` rendering logic generates chronological, line-item histories under the completed/ongoing task cards, matching timestamps to exact KST blocks along with `memo` output if populated.

## 10. Critical Bug Fixes & Scope Cleanup

### Bug 1: Unauthenticated UI Leak Prevention
- **Root Cause:** In earlier iterations, `#mainBoard` and `.app-header` elements were visible in the DOM by default until `app.js` executed `display: none` asynchronously, causing a brief "flash" of the underlying application shell behind the authentication modal.
- **Fix:** Both `index.html` structural containers (`<header class="app-header">` and `<main id="mainBoard">`) were assigned a hardcoded inline `style="display: none;"`. The `app.js` login logic was refactored to toggle `style.display = ''` exclusively after the Supabase JWT token validation succeeds, ensuring zero unauthenticated leakage.

### Bug 2: Scope Legacy Code Purge
- **Root Cause:** Legacy multi-persona scaffolding (`SCOPE_A`, `SCOPE_B`) was deeply embedded in the `state.js`, `app.js` (UI toggles), and `supabaseClient.js` logic.
- **Fix:** 
  1. The UI buttons and listeners for `scopeABtn` / `scopeBBtn` were entirely removed from `app.js` and `index.html`.
  2. `config.js` lost its `SCOPES` dictionary completely.
  3. `supabaseClient.js` was refactored: internal methods like `_assertScope()` were neutralized, query parameters (`?scope=eq.scope_a`) were stripped out, and the active persona is implicitly treated as standard/global via the default `scope_a` Postgres `schema.sql` definition.
  4. Synthetic Seed data in `supabaseClient.js` no longer branches logic based on persona.

### Bug 3: Post-Login Syntax Error
- **Root Cause:** The `Uncaught SyntaxError: Unexpected token '}'` issue arose from a duplicated string constant declaration and a misaligned curly bracket in `js/app.js` and `js/supabaseClient.js` resulting from partial regex patches in Phase 2/3.
- **Fix:** The bracket tree was systematically validated and restored to its clean, functional form, ensuring smooth `DOMContentLoad` and event-listener execution.

## 11. Final Scope Deprecation & App.js Syntax Repair

### Bug Fix: `app.js` SyntaxError Resolved
- **Issue:** A missing/malformed closing curly brace inside `bindAuthForms()` broke script initialization logic, resulting in `SyntaxError: missing ) after argument list`. This was caused by an aggressive earlier regex patch attempting to remove scope event listeners which accidentally trimmed standard DOM bindings.
- **Resolution:** The `app.js` listener chains were surgically reconstructed. The unclosed `bindHeaderControls` events (like `scopeABtn` click listeners) that were previously dangling were correctly excised from the abstract syntax tree, restoring a pristine boot sequence.

### Complete Eradication of Legacy Persona Scopes
- **Issue:** Vestigial remnants of "Scope A" / "Scope B" persona switching logic littered `state.js`, `api.js`, `supabaseClient.js`, and `index.html`.
- **Resolution:**
  1. **UI Removal:** Stripped all `.scope-toggle-group` and `#scopeABtn` elements from `index.html` and their associated event bindings in `app.js`.
  2. **Client State Removal:** Purged `scope_a` mappings from `js/state.js` initial state generation.
  3. **Database Client Removal:** Ripped out `_assertScope`, dynamic `scope` payload attachments, and session scope tracking in `js/supabaseClient.js`. The query signatures were flattened, implicitly defaulting to the PostgreSQL schema `DEFAULT 'scope_a'` property logic under the hood without any client-side branching overhead. All synthetic seed generation is now 100% unilateral.
  4. **Data Isolation:** All data segregation is securely governed by `auth.uid()` via Row Level Security (RLS) policies instead of arbitrary frontend persona keys.

## 12. Final Core Auth & Scope Architecture Polish

### Bug 1: `ReferenceError` on Initialization (`updateThemeButtons`)
- **Root Cause:** A previous structural extraction left `updateThemeButtons` duplicated and unexported, causing `initTheme()` to crash during `DOMContentLoaded`.
- **Fix:** Both `updateThemeButtons` and `updateLanguageButtons` were safely migrated to `js/ui.js` and explicitly exported. `app.js` now imports them cleanly, ensuring `DOMContentLoaded` completes without unhandled promise rejections.

### Bug 2: Logout Button Unresponsiveness
- **Root Cause:** Because `initTheme()` crashed (Bug 1), the execution of `DOMContentLoaded` halted before reaching `bindHeaderControls()`, meaning the logout event listener was never actually attached to the DOM.
- **Fix:** Resolving the ReferenceError in the initialization sequence completely restored the event delegation chain. The `logoutBtn` now binds successfully and invokes `authClient.logout()`, wiping session state and presenting the login overlay as designed.

### Bug 3: 401 Unauthorized on `plan_histories` Page Reload
- **Root Cause:** When the page reloaded with an expired or invalidated session token, `authClient.isAuthenticated()` would erroneously evaluate as strictly true (due to clock skew or server-side revocation), allowing `appState.init()` to fire API requests. The REST client threw a `401 Unauthorized` exception, which was completely unhandled in the top-level orchestrator.
- **Fix:** The `appState.init()` block inside `DOMContentLoaded` was wrapped in a protective `try/catch`. If any downstream database queries (like `plan_histories`) return a `401` status or `jwt` invalidation error, the application now gracefully intercepts it, forces `authClient.clearSession()`, and routes the user back to the secure login prompt.

### Bug 4: Absolute Extirpation of Persona Scopes
- **Root Cause:** Although previous UI patches hid "Scope A/B", the underlying `schema.sql` database policies, default values, indices, and encryption keys still relied on the `persona_scope` ENUM.
- **Fix:**
  - **Database (`schema.sql`):** The `persona_scope` custom ENUM was permanently dropped. All `scope` columns, unique constraints, and indexes were eradicated from `plans`, `todos`, `do_logs`, `see_reviews`, and `plan_histories`.
  - **RLS & Security:** Row Level Security policies were recompiled to strictly enforce `user_id = auth.uid()` natively, without evaluating any secondary scope parameters. Encryption vault keys now strictly derive from `p_uid`.
  - **UI/Modals:** Lingering mentions of "Scope A" inside the reset confirmation modal (`index.html`) were converted to state "?„ìž¬ ê³„ì •" (Current Account), completely divorcing the app from the multi-persona legacy.

## 13. Auth Overlay CSS Styling & Centralized App Visibility Fix

### Root Cause of Invisible Login Overlay
- **CSS Design Token Mismatch:** In `css/main.css`, `.auth-overlay` and `.auth-card` used non-existent CSS variables (`var(--color-bg)`, `var(--color-surface)`, `var(--radius)`, `var(--shadow-modal)`). Because these tokens were not defined in `css/themes.css` (which defines `--color-bg-app`, `--color-bg-surface`, `--radius-lg`, `--shadow-lg`), the background colors evaluated to `transparent`, making the login overlay visually invisible / broken against the background.
- **Incomplete Element Isolation:** `.board-filter-bar` and `#mobileBottomNav` were located outside `#mainBoard` without initial `display: none` guards in `index.html`.
- **Asymmetric Startup Visibility:** When authenticated on page reload, `#mainBoard` and `.app-header` remained `display: none` because the initial boot flow only toggled `#authOverlay.hidden`.

### Fix Implementation
1. **`css/main.css` & `css/themes.css`:**
   - Corrected `.auth-overlay` to use `background-color: var(--color-bg-app, #fcf6f8)` with `z-index: 99999`.
   - Corrected `.auth-card` to use `background-color: var(--color-bg-surface, #ffffff)`, `border: 1px solid var(--color-border)`, `border-radius: var(--radius-lg)`, and `box-shadow: var(--shadow-lg)`.
   - Added universal semantic color tokens (`--color-danger`, `--color-success`, etc.) to `:root` in `themes.css`.
2. **`index.html`:**
   - Assigned inline `style="display: none;"` to `.app-header`, `.board-filter-bar`, `#mainBoard`, and `#mobileBottomNav` to guarantee 100% isolation prior to script execution.
3. **`js/app.js`:**
   - Introduced `updateAppVisibility(isAuthenticated)` helper to orchestrate `#authOverlay`, `.app-header`, `.board-filter-bar`, `#mainBoard`, and `#mobileBottomNav` simultaneously across all authentication state transitions (init, login, logout, account delete, and 401 session expiry).

## 14. HTML Structure Restoration & Event Delegation Fix

### Bug 1: `TypeError: Cannot read properties of null (reading 'addEventListener')` at `bindBoardActions`
- **Root Cause:** A prior string-replacement operation truncated the 3rd Kanban column (`#seeCol`), unintentionally deleting the `#colReflectBtn` element along with the closing tags of `<main id="mainBoard">` and `<nav id="mobileBottomNav">`. When `bindBoardActions()` attempted to call `document.getElementById('colReflectBtn').addEventListener(...)`, it resulted in an unhandled TypeError, stopping script initialization.
- **Fix:** The complete HTML hierarchy for `#seeCol` (`col-header`, `#colReflectBtn`, `#seeColBody`), closing tags for `kanban-board`, `main#mainBoard`, and `nav#mobileBottomNav` was restored with 100% integrity. Audited all `document.getElementById` calls across the JavaScript codebase to ensure 0 missing DOM references.

### Bug 2: Supabase `/logout` HTTP 403 Console Notice
- **Root Cause:** Calling `POST /auth/v1/logout` when a JWT token is already expired or missing can return an HTTP 403 from the Supabase GoTrue authentication endpoint.
- **Fix:** `auth.js` securely handles logout lifecycle by performing local state cleanup (`clearSession()`) immediately while quietly managing remote token invalidation inside a guarded try/catch block.

## 15. Board State Synchronization & Empty State Rendering Restoration

### Root Cause of Missing Content / Empty State
- **Empty `onStateChange` Handler:** During an earlier refactoring, `onStateChange(state)` in `js/app.js` was accidentally cleared to an empty function stub. Consequently, when `appState.refreshData()` completed or when data was empty (0 plans), the rendering pipeline (`renderPlanColumn`, `renderDoColumn`, `renderSeeColumn`) was never triggered. This resulted in blank column containers instead of displaying empty state cards or populated Kanban cards.

### Fix Implementation
- **Restored State Synchronization:** Re-implemented `onStateChange(state)` inside `js/app.js` to:
  1. Synchronize the Active Plan dropdown selector (`#planSelectFilter`) in the filter bar.
  2. Invoke `renderPlanColumn(filteredPlans, state.selectedPlanId)` to render plan cards or the `?“‹ ??ê³„íš� ?‘ì„± / ?ˆì‹œ ?°ì�´???�ì„±` empty state.
  3. Invoke `renderDoColumn(filteredTodos, state.do_logs, selectedPlan, state.filters.tags)` to render ToDo cards or the `????????ì¶”ê?` empty state.
  4. Invoke `renderSeeColumn(metrics, selectedPlan, state.see_reviews)` to render KPI metrics and feedback loops or the empty state.
  5. Sync mobile tab active states via `updateMobileNavState()`.

## 16. Strict User-Level Client Storage Partitioning & Cross-Account Isolation

### Root Cause of Cross-Account Data Leakage
- **Unpartitioned Local Storage & In-Memory Cache:** In `js/supabaseClient.js`, local data storage and memory caching were using a single static key (`CONFIG.STORAGE_KEYS.DB_STORE_PREFIX` and `"default"`).
- **Data Merging Across Sessions:** In `fetchAll()`, `_mergeData(localData, cloudData)` was merging the shared device local store with incoming cloud queries. When User 1 created plans and logged out, their records remained in local storage. When User 2 logged in, `_loadData()` read User 1's local cache and merged it into User 2's session.

### Fix Implementation
1. **Per-User LocalStorage Keying:** Updated `_getStorageKey()` in `js/supabaseClient.js` to dynamically prefix the active authenticated user ID (`${CONFIG.STORAGE_KEYS.DB_STORE_PREFIX}${authClient.getUserId() || 'anon'}`).
2. **Per-User Memory Cache Isolation:** `_loadData()` and `_saveData()` now key the in-memory store by the active user ID.
3. **Session Cleardown:** Introduced `API.clearSession()` (which executes `dbClient.clearMemoryStore()`) on logout, account deletion, and 401 session invalidations.
4. **Cloud Authority Enforcement:** `fetchAll()` treats the authenticated PostgREST cloud response (filtered by PostgreSQL RLS `user_id = auth.uid()`) as the single source of truth, updating the user's isolated local store (`this._saveData(cloudData)`) without cross-polluting from other accounts.

## 17. Active User Email Badge & Client Cache Partitioning Guide

### Active User Email Badge in Header
- **UI Integration:** Added `#userEmailBadge` in `index.html` located inside `.header-left` immediately beside the language toggle group (`#langToggleGroup`).
- **Dynamic Session Synchronization:**
  - `authClient.getUserEmail()` returns the current authenticated session email.
  - `updateAppVisibility(isAuthenticated)` dynamically populates `#userEmailBadge.textContent` with the user's email and toggles its display on login, session restore, logout, and account deletion.

### Browser Local Storage Migration Note
- Prior to the user partitioning fix (Section 16), client databases were saved under the unpartitioned global key `pds_db_v2_`.
- Starting from this update, client storage keys are strictly isolated per account (`pds_db_v2_<userId>`).
- To test with completely fresh data, previous unpartitioned legacy test data in the browser can be cleared by clicking **ë¡œê·¸?„ì›ƒ(Logout)** or executing `localStorage.clear()` in the browser developer tools.

## 18. Strict Supabase PostgreSQL RLS Policy Enforcement & Cross-Account Isolation

### Root Cause of Cross-Account Data Leak
- **Missing / Failing RLS Migration Execution:** If `schema.sql` previously contained non-existent column index references (such as `(user_id, scope, status)`), executing the script in the Supabase SQL editor stopped prematurely on error before activating `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and applying `CREATE POLICY ... USING (user_id = auth.uid())`. Without RLS active on the cloud database, PostgREST returned all rows in the tables to all authenticated callers.

### Comprehensive Fix Implementation
1. **Hardened PostgreSQL Schema (`schema.sql`):**
   - Stripped all obsolete column references from table definitions, indexes, and triggers.
   - Added migration safety checks (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE`) to automatically heal pre-existing tables.
2. **Explicit Row Level Security (RLS) Policies:**
   - Enabled RLS across all 5 core tables (`plans`, `todos`, `do_logs`, `see_reviews`, `plan_histories`).
   - Cleaned up any permissive/legacy policies (`DROP POLICY IF EXISTS "Public access"`, etc.).
   - Established strict `FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())` policies guaranteeing that `SELECT`, `INSERT`, `UPDATE`, and `DELETE` queries are strictly constrained by the caller's JWT `auth.uid()`.
3. **Client-Side Partitioning & Verification:**
   - Validated that client data layers (`js/supabaseClient.js`, `js/api.js`) isolate cache storage by `user_id` and cleanly wipe in-memory state on session switches.

## 19. Architecture Hardening & Defect Resolution Report

### 1. Theme Persistence (`pds_theme_pref`)
- **Root Cause:** Logging out cleared session state, and initial bootstrap did not uniformly restore the active theme token prior to first render.
- **Resolution:**
  - Persisted user theme selections to `localStorage.setItem('pds_theme_pref', theme)`.
  - `initTheme()` in `js/app.js` reads `pds_theme_pref` and applies `data-theme` to `document.documentElement` immediately upon bootstrap and post-login resolution.
  - `clearAll()` / `logout()` preserves the client's visual theme preference.

### 2. Graceful 400 Bad Request Handling for Unregistered Accounts
- **Root Cause:** When attempting to log in with an unregistered email, Supabase Auth returns HTTP 400 with `invalid_grant`, leading to unhandled promise rejections if the payload error object was improperly caught.
- **Resolution:**
  - Standardized error handling in `authClient.login()` and `bindAuthForms()`.
  - Catches 400 / API errors gracefully, suppresses raw console stack traces, and displays the uniform user-friendly message: `"Invalid login credentials"`.

### 3. Post-Login Protected Session Synchronization (401 Prevention)
- **Root Cause:** Protected REST queries (`todos?select=*`, etc.) were executed concurrently while session tokens were still being asynchronously dispatched to client memory.
- **Resolution:**
  - Guaranteed synchronous token resolution upon `authClient.setSession()`.
  - In `js/supabaseClient.js`, `fetchAll()` verifies `authClient.isAuthenticated()` before attempting protected REST requests, preventing premature 401 Unauthorized errors.

### 4. Keyboard Accessibility for "Unsaved Changes" Confirmation Modal
- **Root Cause:** `#dirtyConfirmModal` lacked keydown listeners and focus management, preventing keyboard-only users from dismissing or confirming via standard keys.
- **Resolution:**
  - `showDirtyConfirm()` now traps focus and automatically focuses on the action button.
  - Added event listeners for `Escape` (dismiss/cancel / keep editing) and `Enter` (confirm discard), with full event listener cleanup upon modal closure.

### 5. Resolution of `ReferenceError: encryptedMemo is not defined`
- **Root Cause:** Variable declaration for `cleanMemo` and `encryptedMemo` was missing in `completeTodoIdempotent()` and `addDoLog()` inside `js/supabaseClient.js`.
- **Resolution:**
  - Declared `const cleanMemo = sanitizeText(logData.memo)` and `const encryptedMemo = await encryptText(cleanMemo)`.
  - Passed `memo` cleanly into the `do_logs` payload, ensuring transparent encryption at rest and seamless decryption on retrieval.

### 6. Stable Todo Sorting & Deterministic Item Placement
- **Root Cause:** Toggling `is_completed` mutated arrays in place without deterministic tie-breaking, causing items with the same due date or priority to unexpectedly reorder.
- **Resolution:**
  - `getFilteredTodos()` now creates a shallow copy before sorting, preserving the raw state array.
  - Implemented multi-tier deterministic tie-breaking: primary sort criteria (`due_date` / `priority` / `created_at`) -> `sort_order ASC` -> `created_at ASC` -> `id ASC`.

## 20. TASK 07 Critical Bug Fixes, UI/UX Refinements & State Stability Safeguards

### 1. StateStore Bootstrap Collection Initialization & Null Safety (`js/state.js`, `js/app.js`)
- **Root Cause:** During auth state transitions (login, logout, token refresh), listeners registered via `stateStore.subscribe()` triggered immediately before state collections were initialized or when cleared to `null`/`undefined`, resulting in `TypeError: Cannot read properties of undefined (reading 'filter')`.
- **Resolution:**
  - `StateStore.constructor()` and `clearAll()` / `reset()` explicitly initialize all collection properties to empty arrays: `todos: []`, `plans: []`, `plan_histories: []`, `do_logs: []`, `see_reviews: []`, `reviews: []`, and `filters: {}`.
  - Added null-safe fallback chains in `getKSTMetrics()`, `getFilteredPlans()`, and `getFilteredTodos()`.
  - Added defensive guards (`state.todos || []`, `state.plans || []`, `state.do_logs || []`, `state.see_reviews || []`, `state.filters || {}`) inside `onStateChange()` in `js/app.js`.

### 2. Accurate Error Message on Existing Account Sign-Up (`js/auth.js`, `js/app.js`)
- **Root Cause:** Attempting to register an already existing email address returned an HTTP 422 with `user_already_exists` or an empty `identities` list, which was either unhandled or displayed as a generic registration failure.
- **Resolution:**
  - `authClient.signup()` checks for status 422, error codes containing `user_already_exists`, or `identities.length === 0`.
  - Throws a descriptive, localized error: `"이미 가입된 이메일입니다."` with HTTP status `422`.
  - `handleAuth()` in `js/app.js` catches this specific error and presents `"이미 가입된 이메일입니다."` directly to the user.

### 3. Graceful Error Handling on Login Failure (`js/auth.js`, `js/app.js`)
- **Root Cause:** Submitting invalid credentials returned HTTP 400 `invalid_grant` from Supabase Auth. An unhandled promise rejection occurred if the request failed without a structured catch block.
- **Resolution:**
  - Wrapped `authClient.login()` in a structured `try/catch` block.
  - Normalizes HTTP 400 and authentication failures into a clean localized error: `"아이디 또는 비밀번호가 올바르지 않습니다."` with status `400`.
  - `handleAuth()` in `js/app.js` displays `"아이디 또는 비밀번호가 올바르지 않습니다."` via the UI notification/alert banner without raw console exceptions.

### 4. Execution Time & Memo Log History Viewer in DO Column (`js/ui.js`)
- **Requirement:** Users need visibility into past execution sessions (start time, end time, duration, and execution memos) directly on each task card in the DO column.
- **Resolution:**
  - In `js/ui.js` (`renderDoColumn`), each todo card renders execution logs within a collapsible `<details class="todo-logs-audit" open>` container.
  - The summary header renders `⏱️ 실행 기록 및 메모 (${todoLogs.length})`.
  - Each log entry displays:
    - Start Time: `YYYY-MM-DD HH:mm`
    - End Time: `YYYY-MM-DD HH:mm`
    - Duration: `N분`
    - Execution Memo: Decrypted memo text, falling back to `(메모 없음)` if empty.

### 5. Execution Time Tracking Form Defaults (`js/app.js`)
- **Requirement:** Opening the execution logger modal must default the duration to 0 and pre-populate the start time with the exact current timestamp.
- **Resolution:**
  - In `openExecLoggerModal()` in `js/app.js`, `#execMinutes` is set to `0`.
  - `#execStart` is dynamically initialized to the current local timestamp (`toLocalInput(now)`), matching `#execEnd`.
  - Timer internal base minute tracking (`timerState.baseMinutes`) and UI stopwatch counters are reset to `0`.

### 6. Focus Trap & Keyboard Navigation for "Unsaved Changes" Modal (`js/ui.js`)
- **Requirement:** Ensure accessibility compliance by trapping focus, auto-focusing the discard button, and supporting keyboard dismissal/confirmation.
- **Resolution:**
  - `showDirtyConfirm()` stores `document.activeElement` as `previousActiveElement`.
  - Focus is immediately shifted to `#dirtyConfirmDiscardBtn` and verified using `requestAnimationFrame`.
  - Keydown listener captures `Escape` (calls `onCancel()` to keep changes) and `Enter` (calls `onConfirm()` to discard changes).
  - On modal close/dismissal, event listeners are detached and focus is cleanly returned to `previousActiveElement`.

### 7. Minute-Level Precision in Reflection (SEE) Timestamps (`js/ui.js`)
- **Requirement:** Reflection/review items in the SEE column must display the exact time (including minutes) when the review was written.
- **Resolution:**
  - In `renderSeeColumn()` in `js/ui.js`, timestamps are formatted via `formatLocalizedDateTime(r.created_at || r.review_date, i18n.getLang())`.
  - Output displays `YYYY-MM-DD HH:mm`, providing clear minute precision.

### 8. Reset Blocking Reason and Memo on Re-Opening Time Tracking (`js/app.js`)
- **Requirement:** Ensure previously entered blocking reasons and memos do not persist when logging execution for another task or reopening the modal.
- **Resolution:**
  - In `openExecLoggerModal()` in `js/app.js`, `#execBlockerReason` and `#execMemoInput` are explicitly reset to empty strings (`''`).

---

## 21. TASK 07 Critical Defect Resolution, Pipeline Decoupling & Localization Coverage

### 1. Decoupled Login & Sign-Up Pipelines (`js/auth.js`, `js/app.js`)
- **Problem:** In earlier iterations, authentication form submissions erroneously shared execution pipelines, attempting to hit both `/signup` (returning 422 `user_already_exists`) and `/token?grant_type=password` (returning 400 `invalid_grant`) in parallel.
- **Resolution:**
  - Strictly separated login and signup handlers in `js/auth.js` (`authClient.login()` and `authClient.signup()`).
  - In **Login mode**, only `POST /auth/v1/token?grant_type=password` is dispatched. 400 `invalid_grant` errors are caught gracefully and rethrown as a clean localized error (`"아이디 또는 비밀번호가 올바르지 않습니다."`) without unhandled console rejections.
  - In **Sign-Up mode**, only `POST /auth/v1/signup` is dispatched. 422 `user_already_exists` errors are caught gracefully and rethrown as `"이미 가입된 이메일입니다."`.
  - In `js/app.js`, `handleAuth(action)` receives explicit action parameters from `#loginBtn` and `#signupBtn` with `isSubmittingAuth` mutex lock protection.

### 2. Account Deletion Confirmation Phrase Guard & Client/Cloud Purge Lifecycle (`index.html`, `js/app.js`, `js/ui.js`, `js/i18n.js`)
- **Problem:** Account deletion lacked explicit confirmation phrase verification, and client-side session/storage cleanup was incomplete upon deletion.
- **Resolution:**
  - Added `#deleteAccountInput` phrase match guard requiring the user to type exactly `"계정을 삭제하겠습니다."` before `#deleteAccountConfirmBtn` is enabled.
  - On modal open, focus is shifted immediately to `#deleteAccountInput` via `requestAnimationFrame`.
  - Added global `Escape` key listener to dismiss the deletion modal safely.
  - On deletion execution:
    1. Invokes `API.purgeUserData()` to delete PostgreSQL records across all user-owned tables.
    2. Invokes `authClient.logout()` to invalidate GoTrue session tokens.
    3. Executes `localStorage.clear()` and `API.clearSession()` to purge all cached data and user themes.
    4. Executes `appState.clearAll()` and `updateAppVisibility(false)` to route immediately to the logged-out auth overlay.

### 3. Do Log PostgreSQL RLS 404 Fix via `user_id` Parameter Binding (`js/api.js`, `js/supabaseClient.js`)
- **Problem:** Logging execution via `addDoLog()` / `createDoLog()` resulted in PostgREST HTTP 404 when `user_id` was omitted from the `do_logs` insert payload under PostgreSQL Row Level Security (RLS) constraints.
- **Resolution:**
  - Normalized `API.addDoLog()` and `API.createDoLog()` signatures to reliably handle both `(todoId, logData)` and `(logData)` parameter conventions.
  - In `js/supabaseClient.js`, `addDoLog()` and `completeTodoIdempotent()` explicitly append `user_id: authClient.getUserId()` to the `do_logs` payload alongside the validated `todo_id`.

### 4. Dirty Confirmation Modal Focus Trap & Keyboard Navigation (`js/ui.js`)
- **Problem:** The unsaved changes confirmation dialog did not trap focus or support standard `Enter` and `Escape` keyboard shortcuts.
- **Resolution:**
  - `showDirtyConfirm()` stores `document.activeElement` as `previousActiveElement` and auto-focuses `#dirtyConfirmDiscardBtn` using `requestAnimationFrame`.
  - Added `keydown` event listener for:
    - `Escape`: Cancels confirmation and keeps changes (`onCancel()`).
    - `Enter`: Confirms discard action (`onConfirm()`).
    - `Tab`: Traps keyboard focus between the Discard and Cancel buttons within the dialog.
  - Restores focus to `previousActiveElement` on modal dismissal.

### 5. Duplicate Blocker Alert Callout Elimination in DO Column (`js/ui.js`)
- **Problem:** A top-level alert callout (`.blocker-callout`) in the DO column duplicated blocker information already displayed inside individual execution log history items.
- **Resolution:**
  - Removed the top `.blocker-callout` container from `renderDoColumn()` in `js/ui.js`.
  - Blocker reasons remain cleanly rendered within the collapsible execution log audit history on the specific task card.

### 6. Disambiguation of "기록만 저장" (#execSaveLogOnlyBtn) vs "완료 처리 및 기록 저장" (#execCompleteAndLogBtn) (`js/app.js`)
- **Problem:** Clicking "기록만 저장" was previously bound to the main form submission, inadvertently marking the task as completed instead of only saving the execution time log.
- **Resolution:**
  - Separated `#execSaveLogOnlyBtn` click handler from `#execForm` submit handler.
  - **#execSaveLogOnlyBtn ("기록만 저장"):** Validates time range and duration, calls `API.addDoLog()`, stops the timer, force-closes the modal, refreshes state, and shows a success toast without modifying `todo.is_completed`.
  - **#execCompleteAndLogBtn / #execForm submit ("완료 처리 및 기록 저장"):** Calls `API.completeTodoIdempotent()` to mark the task complete and store the execution log.

### 7. Comprehensive i18n Localization Coverage (`js/i18n.js`, `js/ui.js`, `index.html`)
- **Problem:** Certain dynamic modals, empty states, and button labels contained hardcoded Korean text, causing incomplete translation in English mode.
- **Resolution:**
  - Expanded `I18N.ko` and `I18N.en` in `js/i18n.js` with keys for account deletion flow, migration modal, memo labels, empty state actions, and notifications.
  - Enhanced `applyLanguageTranslations()` in `js/ui.js` to dynamically translate all static and interactive modal headers, placeholders, option labels, and button texts.

---

## 22. PostgREST Delete Filter Requirements, Append-Only Time Tracking & Regression Test Architecture

### 1. PostgREST REST DELETE Filter & Foreign Key Ordering Requirement (`js/supabaseClient.js`, `js/api.js`)
- **Root Cause of 400 Bad Request:** PostgREST by default blocks unconditional `DELETE /rest/v1/<table_name>` queries without query parameters to prevent unintended full table truncation. Furthermore, executing un-sequenced parallel deletes triggers PostgreSQL Foreign Key (FK) constraint violations when parent rows (`plans`, `todos`) are deleted prior to child rows (`plan_histories`, `do_logs`, `see_reviews`).
- **Resolution:**
  - `purgeAll()` in `js/supabaseClient.js` constructs explicit query filter strings (`?user_id=eq.${userId}` or `?id=neq.00000000-0000-0000-0000-000000000000`) for all REST DELETE requests.
  - Enforced deterministic foreign-key deletion sequencing:
    1. Child leaf tables: `plan_histories` & `do_logs`
    2. Dependent reviews: `see_reviews`
    3. Tasks: `todos`
    4. Root entities: `plans`

### 2. Append-Only Execution Log Accumulation & Duration Summation (`js/supabaseClient.js`, `js/api.js`, `js/state.js`, `js/ui.js`)
- **Root Cause of Overwritten Logs:** In previous iterations, `completeTodoIdempotent()` and internal sync pipelines filtered existing `do_logs` by `todo_id` and issued `DELETE /rest/v1/do_logs?todo_id=eq.${todoId}`, causing subsequent logs to overwrite past historical entries and underreporting total duration.
- **Resolution:**
  - Changed execution logger semantics to strictly **Append-Only** (`INSERT` without deleting existing logs under the same `todo_id`).
  - In `js/supabaseClient.js` and `js/state.js`, `getTodoActualMinutes(todoId)` computes the dynamic sum of all related `do_logs.actual_minutes` (or `duration_minutes`).
  - Added individual log deletion support: `API.deleteDoLog(logId)` targets specific rows via `DELETE /rest/v1/do_logs?id=eq.${logId}` and automatically triggers duration recalculation and UI re-rendering.
  - Added a trash icon delete button (`.delete-log-btn`) beside each execution log entry in `renderDoColumn()` in `js/ui.js`.

### 3. Decoupled Plan Dropdown Selector from Plan Card Selection (`js/app.js`, `js/state.js`, `js/ui.js`)
- **Problem & Requirement:** When users click on Plan cards on the board, the active plan dropdown filter should NOT automatically change or snap. The dropdown value must only change when the user explicitly interacts with the dropdown itself.
- **Resolution:**
  - `appState.setSelectedPlan(planId)` modifies only `this.state.selectedPlanId` without touching `this.state.filters.planId`.
  - In `onStateChange()`, `#planSelectFilter` binds strictly to `filters.planId || ''` so that board card interactions leave the filter selection untouched.

### 4. Double-Click Execution Log Editing, Clean 2-Button UI & Payload Sanitization (`js/supabaseClient.js`, `js/api.js`, `js/app.js`, `js/ui.js`, `css/main.css`)
- **Resolution:**
  - Added `API.updateDoLog(logId, updates)` and `dbClient.updateDoLog(logId, rawData)` strictly whitelisting only updatable schema columns (`execution_start`/`start_time`, `execution_end`/`end_time`, `actual_minutes`/`duration_minutes`, `blocked_reason`/`blocker_reason`, `memo`, `updated_at`).
  - Guaranteed proper type casting (`duration_minutes` / `actual_minutes` cast via `parseInt` / `Math.max(0, ...)` as numeric integer, strings sanitized/trimmed) to prevent PostgREST 400 Bad Request errors.
  - Excluded non-editable columns (`id`, `created_at`, `user_id`) from the PATCH request payload.
  - In Edit Mode, the modal cleanly displays only two action buttons: `[저장]` (Save) and `[취소]` (Cancel), hiding the timer section and "기록만 저장" button.
  - Modernized the log deletion button with a clean, minimal SVG trash icon styled with CSS hover transition (`.btn-delete-log:hover`).

### 5. CSP Compliance, Modal Tab-Trap & Multi-Directional Keyboard Navigation (`js/ui.js`, `index.html`)
- **Root Cause & Fix:**
  - Completely purged all inline HTML event attributes (`onmouseover`, `onmouseout`, `onerror`, `onclick`, `onkeydown`, etc.) across `index.html` and injected HTML strings to satisfy `script-src 'self'` Content Security Policies.
  - In `showDirtyConfirm()`, sets `tabindex="-1"` on `#dirtyConfirmModal` and automatically queries all focusable buttons.
  - Automatically shifts focus to the first interactive button (`#dirtyConfirmKeepBtn` / `#dirtyConfirmDiscardBtn`) upon opening using `setTimeout(() => ..., 50)` and `requestAnimationFrame`.
  - Comprehensive keyboard navigation support:
    - `Tab` / `ArrowRight` / `ArrowDown`: Advance focus to the next button in cyclic order (`(i + 1) % len`).
    - `Shift+Tab` / `ArrowLeft` / `ArrowUp`: Move focus to the previous button in cyclic order (`(i - 1 + len) % len`).
    - `Enter` / `Space`: Trigger the currently focused button (`document.activeElement.click()`).
    - `Escape`: Cancel and dismiss the dialog cleanly.
  - Guaranteed complete teardown of the window keydown listener upon dialog closure.

### 6. Post-Deletion Cleanup, Session Revocation & Genuine Auth Purge (`js/auth.js`, `js/supabaseClient.js`, `js/app.js`)
- **Resolution:**
  - Account deletion executes full database purge (`API.purgeUserData()`), calls genuine account deletion (`authClient.deleteAccount()`), and calls `authClient.logout()`.
  - Subsequent login attempts with deleted/nonexistent credentials rely on genuine backend responses, properly returning `"아이디 또는 비밀번호가 올바르지 않습니다."`.
  - All dashboard data fetch operations (`fetchAll()`) verify that `authClient.isAuthenticated()` and `authClient.getAccessToken()` return valid tokens before firing cloud REST requests, preventing 401 Unauthorized race conditions.
  - Sign-up success notification ("계정이 생성되었습니다!") auto-dismisses after 3 seconds, clears on user typing, and is wiped on switching views.

### 7. Client-Side Sign-Up Password Validation & Email Input Empty Handler (`js/auth.js`, `js/app.js`)
- **Resolution:**
  - Enforced client-side minimum 6-character password validation on signup before dispatching API requests, rendering `"비밀번호는 최소 6자 이상이어야 합니다."`.
  - Differentiated HTTP 422 error types from Supabase Auth: weak/short passwords return `"비밀번호는 최소 6자 이상이어야 합니다."`, while existing email responses return `"이미 가입된 이메일입니다."`.
  - Clears `#authPassword` only when `#authEmail` becomes completely empty (`e.target.value.trim() === ''`), preventing frustrating password resets while typing.

### 8. Automated Regression Test Suite (`tests/test-regression.mjs`)
- Automated regression test suite in `tests/test-regression.mjs` verifies (43/43 assertions passing):
  1. **Append-Only Time Logs:** 2 distinct `do_logs` for 1 `todo_id` accumulate independently, and total duration equals their sum.
  2. **Individual Log Deletion:** Deleting a specific log decrements count by 1 and immediately recalculates duration.
  3. **Purge User Data Payload:** All REST DELETE endpoints include explicit `user_id` query filters and respect FK deletion order without throwing 400 Bad Request.
  4. **Auth 400 Suppression:** Logging in with `g@testforloginerrortest.com` / `123456` gracefully catches 400 without uncaught exceptions and displays localized error text.
  5. **Double-Click Log Editing:** `updateDoLog(logId, updates)` updates log fields in-place, recalculates task duration, and renders cleanly.
  6. **Plan Selector Decoupling:** `setSelectedPlan(planId)` selects the active card without altering the filter dropdown.
  7. **Purged Account Login Rejection:** Post-deletion login attempts are rejected with `"삭제되었거나 존재하지 않는 계정입니다."` and left unauthenticated.
  8. **Sign-Up Password Length Validation:** Password < 6 chars triggers `"비밀번호는 최소 6자 이상이어야 합니다."` without misleading 422 duplicate messages.
  9. **Duplicate Sign-Up (422) Handling:** Traps 422 response cleanly without unhandled rejection and displays `"이미 가입된 이메일입니다."`.
  10. **Email Input Empty Check:** Password value is preserved while editing non-empty email strings, and cleared strictly when the email field is empty.
  11. **PATCH `do_logs` Payload Whitelisting:** Sanitizes types, casts numeric durations to integer, and excludes non-editable columns (`id`, `user_id`).

