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
**never handles raw password hashes** — credential verification is fully delegated to Supabase Auth.

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
Login → setSession(data) → localStorage["pds_auth_session"] = { access_token, refresh_token, expires_at, user }
                          ↓
Every API request → _getCloudHeaders() → authClient.getAccessToken() → "Authorization: Bearer <token>"
                          ↓
Token expiry → isAuthenticated() returns false → clearSession() → UI redirected to authOverlay
```

### Masking in Logs (T07-C46, T07-C131)
Raw JWTs must never appear in console outputs or error messages. When referencing a token in logs,
use: `eyJhb...[TRUNCATED]`.

---

## 3. RLS Execution Flow (T07-C117 ~ T07-C121)

1. **Client request**: `fetch()` with `Authorization: Bearer <JWT>` header.
2. **Supabase PostgREST**: Validates signature, decodes `sub` claim → sets `auth.uid()` in PostgreSQL session.
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
User logs in → pds_migrated_<user-id> is absent and legacy data exists?
               ↓ YES
            migrationModal opens
               ↓ User clicks "Import"
            API.migrateLocalDataToUser()
               ↓
            decryptText() for sensitive fields → migrateLegacySchema() → validateImportPayload() → dbClient.restoreScopeBackup()
               ↓
            legacy T06 keys removed + completion flag written → appState.init() refreshes from server
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
1. `API.purgeUserData()` — clears the authenticated user's data.
2. `authClient.logout()` — invalidates the server-side session token.
3. `appState.clearAll()` — wipes in-memory state store, notifies UI to render empty state.
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
  - **UI/Modals:** Lingering mentions of "Scope A" inside the reset confirmation modal (`index.html`) were converted to state "?�재 계정" (Current Account), completely divorcing the app from the multi-persona legacy.

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
  2. Invoke `renderPlanColumn(filteredPlans, state.selectedPlanId)` to render plan cards or the `?�� ??계획 ?�성 / ?�시 ?�이???�성` empty state.
  3. Invoke `renderDoColumn(filteredTodos, state.do_logs, selectedPlan, state.filters.tags)` to render ToDo cards or the `????????추�?` empty state.
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
- To test with completely fresh data, previous unpartitioned legacy test data in the browser can be cleared by clicking **로그?�웃(Logout)** or executing `localStorage.clear()` in the browser developer tools.

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
