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
3. **RLS policy evaluation**: Every query has an implicit `AND user_id = auth.uid() AND scope = $active_scope`.
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
After a user successfully authenticates (login or signup), the app checks whether `localStorage`
contains a T06 scope data key (`pds_db_v2_scope_a` or `pds_db_v2_scope_b`). If data exists, a
non-blocking migration modal is shown.

### Migration Flow
```
User logs in → localStorage.getItem("pds_db_v2_scope_a") exists?
               ↓ YES
            migrationModal opens
               ↓ User clicks "Import"
            API.migrateLocalData()
               ↓
            migrateLegacySchema() → validateImportPayload() → dbClient.restoreScopeBackup()
               ↓
            localStorage key removed → appState.init() refreshes from server
```

### Idempotency
`restoreScopeBackup()` performs Map-based deduplication by primary key (`id`), so re-importing
produces 0 duplicate rows regardless of how many times the migration runs.

---

## 6. Account Deletion (T07-C134)

### Client Layer
The "Delete Account" button opens a confirmation modal with an explicit data purge warning. On
confirmation:
1. `appState.purgeActiveScope()` — clears local scope data.
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
