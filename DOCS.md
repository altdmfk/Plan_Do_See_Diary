# Plan-Do-See Diary - System Architecture & Technical Documentation

Comprehensive documentation covering the software architecture, computer science principles, database schema design, security model, and user experience rationale of the **Plan-Do-See Diary** web application.

---

## 1. Executive Summary & Core Paradigm

The **Plan-Do-See Diary** is a resilient, zero-login, client-and-server isolated evaluation system designed to operationalize the Plan-Do-See management lifecycle. Built purely with modern ECMAScript (ES6+ standard modules, zero TypeScript, zero third-party UI framework bloat), it couples a reactive client state architecture with a PostgreSQL database layer secured via Row Level Security (RLS) and database-level at-rest encryption via `pgcrypto` (T06-C58 Compliant).

```
                      +-----------------------------+
                      |         PLAN STAGE          |
                      |  - Period (KST/EDT)         |
                      |  - Revision Snapshots       |
                      |  - Actionable ToDos         |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      |          DO STAGE           |
                      |  - Drift-safe Execution     |
                      |  - "진행 차단 사유" (Blockers) |
                      |  - Idempotent Token Locking |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      |          SEE STAGE          |
                      |  - Metric Aggregations      |
                      |  - Time Delta Calculation   |
                      |  - 1-Click Feedback Loop    |
                      +--------------+--------------+
                                     |
                                     +------------------+
                                     | Feedback Loop    |
                                     v                  |
                             [ Next Plan Cycle ] <------+
```

---

## 2. Computer Science Principles & Architectural Patterns

### 2.1 Separation of Concerns (SoC)
The codebase strictly decouples responsibilities across distinct modular boundaries:
- **Presentation Layer (`js/ui.js` & `index.html`):** Pure DOM manipulation, theme management, focus trapping, XSS sanitization, and modal lifecycles.
- **State Store (`js/state.js`):** Centralized Single Source of Truth implementing the **Observer Pattern**. Handles optimistic state mutations, rollback snapshots, multi-tag filter predicates, and analytics calculators.
- **Data Access & Boundary Layer (`js/api.js` & `js/supabaseClient.js`):** Enforces persona scope isolation, handles network transactions, communicates with Supabase/Postgres, and provides a faithful in-memory/localStorage evaluation engine.
- **Database Cryptographic Layer (`schema.sql` & `js/crypto.js`):** PostgreSQL `pgcrypto` (`pgp_sym_encrypt`, `pgp_sym_decrypt`) extension enabling transparent server-side encryption at rest with **strictly zero hardcoded client secrets**.
- **Date & Calendar Calculation Engine (`js/dateUtils.js`):** Encapsulates calendar logic calibrated strictly to `Asia/Seoul (KST, UTC+09:00)` and `America/New_York (EDT, UTC-04:00)` with Monday-to-Sunday ISO week boundaries and leap year handling.
- **Validation & Migration Engine (`js/validators.js`):** All-or-nothing schema validators, 5MB file payload boundaries, and legacy v1-to-v2 schema transformers.

### 2.2 Observer Pattern & Reactive State Store
State changes trigger reactive UI rendering without full-page reloads. Components subscribe to `appState.subscribe(listener)`:
```
[User Action] ➔ [appState.mutation()] ➔ [Notify Subscribers] ➔ [UI Renderers]
```

### 2.3 Optimistic UI Updates & Error Rollback
To provide instantaneous feedback, user actions (such as completing a ToDo or deleting an item) immediately mutate the in-memory state and DOM. A snapshot of the previous state is preserved. If the backend mutation fails or is rejected by server RLS:
1. The state store automatically rolls back to the verified snapshot.
2. Subscribers are re-notified to revert the DOM.
3. A non-blocking error toast is rendered to inform the user.

### 2.4 Idempotency & Concurrency Guarantees
- **Client-Side Debounce & Token Locking:** When submitting a task execution, the submit button is immediately disabled, and a client-side `UUIDv4` `completion_token` is generated.
- **Database Idempotent Constraint:** The `do_logs` table enforces `UNIQUE(todo_id, completion_token)`. If duplicate network requests occur, the database performs an idempotent upsert (`ON CONFLICT DO NOTHING`), guaranteeing that exactly 1 execution log is written and the completion count increments by exactly 1.

### 2.5 Background Timer Drift Correction
Instead of relying on `setInterval` tick accumulation (which drifts significantly when mobile operating systems throttle inactive browser tabs), the timer records the absolute epoch timestamp (`startTime = Date.now()`). The displayed duration is calculated as:
$$\text{elapsedSeconds} = \left\lfloor \frac{\text{Date.now}() - \text{startTime}}{1000} \right\rfloor$$
This ensures exact timekeeping across device sleep and backgrounding.

---

## 3. Database Schema & RLS Security Model

### 3.1 Entity Relationship Model
- **`plans`**: Core strategic goals with period dates, estimated hours, and 4-tier priorities.
- **`plan_histories`**: Immutable audit ledger populated automatically via a PostgreSQL trigger (`fn_capture_plan_history`) before every plan update.
- **`todos`**: Granular execution items linked to plans with tags, due dates, and completion timestamps.
- **`do_logs`**: Time-tracking logs recording actual elapsed minutes and blocked reasons ("진행 차단 사유").
- **`see_reviews`**: Retrospective evaluations with automated metric snapshots and adjustment insights.

### 3.2 Server-Side Scope Isolation & Anti-Tampering Shield
- **Persona Scopes:** Two isolated review contexts: `Scope A` (`scope_a`) and `Scope B` (`scope_b`).
- **Row Level Security (RLS):** All tables enforce `USING (scope = current_request_scope())` and `WITH CHECK (scope = current_request_scope())`.
- **Anti-Tampering:** If a malicious client attempts to modify query parameters, body payloads, or headers to access the opposing scope, the database/API layer overrides the forged scope with the established session scope or returns HTTP 403 Forbidden.
- **Zero Cross-Scope Mutation:** When Scope A is purged or reset, Scope B records remain 100% untouched (0 altered rows).
- **In-Memory Cache Purge:** When toggling between Scope A and Scope B in the UI, all in-memory caches, filtered lists, and DOM trees are wiped before fetching target data.

---

## 4. PostgreSQL `pgcrypto` Database-Level Encryption (T06-C58 Compliant)

### 4.1 Server-Side Encryption at Rest
- **PostgreSQL Extension:** Enabled via `CREATE EXTENSION IF NOT EXISTS pgcrypto;` in [`schema.sql`](file:///c:/Users/user/Desktop/tasks/task6/schema.sql).
- **Zero Client Secrets:** The JavaScript client stores zero hardcoded encryption keys, passphrases, or static secret strings, complying strictly with T06-C58.
- **pgcrypto Symmetric Functions:**
  - `pds_encrypt_text(text, scope)`: Encrypts plain text using `pgp_sym_encrypt(text, get_scope_vault_key(scope))` and returns armored ciphertext.
  - `pds_decrypt_text(ciphertext, scope)`: Decrypts armored ciphertext using `pgp_sym_decrypt(ciphertext, get_scope_vault_key(scope))`.
- **Protected Sensitive Fields:**
  - `plans.success_criteria`
  - `todos.description`
  - `do_logs.blocked_reason`
  - `see_reviews.adjustment_insight`
- **Plaintext Metadata:** `title`, `tags`, `due_date`, `priority`, `status`, `estimated_time` remain in plaintext for instantaneous board filtering and searching.
- **Empty String Guard:** Empty strings (`""` or `null`) and whitespace strings are **never encrypted**, preserving accurate blocker counts and metric aggregations in the See stage.
- **Backward Compatibility:** Non-prefixed plain strings parse directly as plaintext without throwing decryption errors.

---

## 5. Strict KST / EDT Date Boundaries

All calendar calculations are evaluated strictly against the active timezone:
1. **Korean Mode:** Asia/Seoul (`UTC+09:00`, KST).
2. **English Mode:** America/New_York (`UTC-04:00`, EDT).
3. **Week Buckets:** Defined as **Monday 00:00:00** through **Sunday 23:59:59**.
4. **Month Buckets:** Defined from **00:00:00 on the 1st** to the final second of the month (accurately handling leap years like Feb 29).
5. **Delay Metric Evaluation:** An item is classified as Delayed if and only if:
   $$\text{is\_completed} = \text{FALSE} \quad \land \quad \text{due\_date} < \text{today}$$
   Completed ToDos are strictly exempt from being counted as delayed.

---

## 6. Backup, Rollback & Legacy Migration

- **Atomic All-or-Nothing Import:** Files are checked against a 5 MB payload limit. Every record is pre-validated for required fields, UUID formats, and valid dates before writing to storage. Any validation failure triggers a complete transaction rollback, ensuring zero database alteration.
- **Idempotent Re-import:** Repeatedly importing the same backup file utilizes primary key upserts, producing 0 duplicate rows.
- **Legacy Migration (v1 ➔ v2):** The migrator automatically identifies legacy format structures (such as flat JSON arrays, `plan_title`, `blocker`, and `estimated_minutes` on plans) and transforms them into standard v2 structures.

---

## 7. UI/UX Design System & Accessibility

- **3-Theme Color Engine (CSS Custom Properties):**
  1. **Pastel Pink:** Soft blush tones, rose accents, warm neutral light surfaces.
  2. **Forest Green:** Calming sage, deep evergreen accents, crisp clean nature surfaces.
  3. **Modern Black:** Obsidian background (`#121212`), high-contrast dark surfaces (`#1E1E1E`), clean borders, and crisp light typography.
- **4-Tier Priority Badges:**
  - 🚨 **Urgent (Red)**
  - 🔥 **High (Amber)**
  - 📌 **Medium (Blue/Theme)**
  - ☕ **Low (Muted Gray)**
- **Dirty Form Guard:** Snapshot-based dirty detection protects users against accidental backdrop dismissals or page reloads with custom confirmation dialogs.
- **Keyboard Shortcuts:**
  - `Ctrl` / `Cmd` + `Enter`: Submit and commit active modal form.
  - `N`: Quick-open "New Plan" creation modal from board view.
  - `1` / `2` / `3`: Quick-switch between Plan, Do, and See columns on mobile.
- **Mobile Touch Gestures:** Horizontal swipe gestures (`touchstart`/`touchend` delta detection) enable seamless transitions between Kanban columns on mobile screens.

---

## 8. Time Duration Integrity & Bidirectional Constraints

- **Unified Minutes Unit (분 단위):**
  - Both strategic Plans and tactical ToDos use positive integer minutes ($> 0$), eliminating conversion ambiguities.
- **Bidirectional Invariant Enforcement:**
  1. **Strict Minimum Duration:** 0 minutes or negative values are strictly blocked across Plans, ToDos, and Do execution logs with immediate focus and error notifications.
  2. **To Do Due Date Boundary:** $\text{todo.due\_date} \le \text{plan.period\_end}$.
  3. **Plan Budget Ceiling:** $\sum \text{child\_todos.estimated\_minutes} \le \text{plan.estimated\_hours}$.
  4. **Plan Reduction Guard:** A plan's target duration cannot be reduced below the sum of its existing child ToDos' estimated minutes.

