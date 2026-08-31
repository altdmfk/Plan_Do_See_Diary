-- Plan-Do-See Diary Database Schema (pds-schema-v2)
-- Database: PostgreSQL 14+ / Supabase with Row Level Security (RLS) & pgcrypto Server-Side Encryption

-- 0. Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Create Enums
DO $$ BEGIN
    CREATE TYPE plan_priority AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE plan_status AS ENUM ('draft', 'active', 'completed', 'archived');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE persona_scope AS ENUM ('scope_a', 'scope_b');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Create Plans Table
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    scope persona_scope NOT NULL DEFAULT 'scope_a',
    title VARCHAR(255) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    priority plan_priority NOT NULL DEFAULT 'medium',
    success_criteria TEXT NOT NULL DEFAULT '',
    estimated_hours NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    status plan_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

-- 3. Create Plan Histories Table (Immutable Snapshot Ledger)
CREATE TABLE IF NOT EXISTS plan_histories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    scope persona_scope NOT NULL DEFAULT 'scope_a',
    revision_number INT NOT NULL DEFAULT 1,
    title VARCHAR(255) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    priority plan_priority NOT NULL,
    success_criteria TEXT NOT NULL,
    estimated_hours NUMERIC(6, 2) NOT NULL,
    status plan_status NOT NULL,
    reason TEXT DEFAULT 'Plan updated',
    changed_at TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

-- 4. Create ToDos Table
CREATE TABLE IF NOT EXISTS todos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    scope persona_scope NOT NULL DEFAULT 'scope_a',
    title VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    due_date DATE NOT NULL,
    priority plan_priority NOT NULL DEFAULT 'medium',
    tags TEXT[] NOT NULL DEFAULT '{}',
    estimated_minutes INT NOT NULL DEFAULT 0,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

-- 5. Create Do Logs Table (Execution Records with Idempotency Token)
CREATE TABLE IF NOT EXISTS do_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    todo_id UUID NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    scope persona_scope NOT NULL DEFAULT 'scope_a',
    execution_start TIMESTAMPTZ NOT NULL,
    execution_end TIMESTAMPTZ NOT NULL,
    actual_minutes INT NOT NULL DEFAULT 0,
    blocked_reason TEXT NOT NULL DEFAULT '',
    completion_token VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    CONSTRAINT uq_do_logs_todo_completion_token UNIQUE (todo_id, completion_token)
);

-- 6. Create See Reviews Table (KST Reflection & Analytics Metrics)
CREATE TABLE IF NOT EXISTS see_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    scope persona_scope NOT NULL DEFAULT 'scope_a',
    review_date DATE NOT NULL,
    planned_count INT NOT NULL DEFAULT 0,
    completed_count INT NOT NULL DEFAULT 0,
    delayed_count INT NOT NULL DEFAULT 0,
    blocked_count INT NOT NULL DEFAULT 0,
    time_delta_minutes INT NOT NULL DEFAULT 0,
    adjustment_insight TEXT NOT NULL DEFAULT '',
    feedback_applied BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

-- Indexes for high-frequency queries
CREATE INDEX IF NOT EXISTS idx_plans_user_scope_status ON plans (user_id, scope, status);
CREATE INDEX IF NOT EXISTS idx_plan_histories_plan ON plan_histories (plan_id, revision_number);
CREATE INDEX IF NOT EXISTS idx_todos_plan_scope ON todos (plan_id, scope);
CREATE INDEX IF NOT EXISTS idx_todos_due_completed ON todos (due_date, is_completed);
CREATE INDEX IF NOT EXISTS idx_do_logs_todo_scope ON do_logs (todo_id, scope);
CREATE INDEX IF NOT EXISTS idx_see_reviews_plan_scope ON see_reviews (plan_id, scope);

-- 7. pgcrypto Key Derivation & Encryption Functions (Zero Client Secrets)
CREATE OR REPLACE FUNCTION get_scope_vault_key(p_scope persona_scope)
RETURNS text AS $$
BEGIN
    RETURN encode(digest('pds_vault_at_rest_' || p_scope::text, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION pds_encrypt_text(p_text TEXT, p_scope persona_scope)
RETURNS TEXT AS $$
BEGIN
    IF p_text IS NULL OR trim(p_text) = '' THEN
        RETURN p_text;
    END IF;
    -- Uses standard AES symmetric cipher via PostgreSQL pgcrypto
    RETURN encode(pgp_sym_encrypt(p_text, get_scope_vault_key(p_scope)), 'base64');
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION pds_decrypt_text(p_ciphertext TEXT, p_scope persona_scope)
RETURNS TEXT AS $$
BEGIN
    IF p_ciphertext IS NULL OR trim(p_ciphertext) = '' THEN
        RETURN p_ciphertext;
    END IF;
    BEGIN
        RETURN pgp_sym_decrypt(decode(p_ciphertext, 'base64'), get_scope_vault_key(p_scope));
    EXCEPTION WHEN OTHERS THEN
        RETURN p_ciphertext; -- Fallback if plaintext
    END;
END;
$$ LANGUAGE plpgsql STABLE;

-- 8. Trigger Function: Snapshot Plan History on Update
CREATE OR REPLACE FUNCTION fn_capture_plan_history()
RETURNS TRIGGER AS $$
DECLARE
    next_rev INT;
BEGIN
    SELECT COALESCE(MAX(revision_number), 0) + 1 INTO next_rev
    FROM plan_histories
    WHERE plan_id = OLD.id;

    INSERT INTO plan_histories (
        user_id, plan_id, scope, revision_number, title,
        period_start, period_end, priority,
        success_criteria, estimated_hours, status,
        reason, changed_at
    ) VALUES (
        OLD.user_id, OLD.id, OLD.scope, next_rev, OLD.title,
        OLD.period_start, OLD.period_end, OLD.priority,
        OLD.success_criteria, OLD.estimated_hours, OLD.status,
        'Revision before update', now() AT TIME ZONE 'utc'
    );

    NEW.updated_at = now() AT TIME ZONE 'utc';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_capture_plan_history ON plans;
CREATE TRIGGER trg_capture_plan_history
    BEFORE UPDATE ON plans
    FOR EACH ROW
    WHEN (OLD.* IS DISTINCT FROM NEW.*)
    EXECUTE FUNCTION fn_capture_plan_history();

-- 9. Row Level Security (RLS) Configuration & Public API Grants
-- Explicitly revoke access from anon to enforce HTTP 403/404 for unauthenticated requests
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE do_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE see_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_plans_auth ON plans;
CREATE POLICY rls_plans_auth ON plans
    FOR ALL TO authenticated
    USING (user_id = auth.uid() AND scope IN ('scope_a'::persona_scope, 'scope_b'::persona_scope))
    WITH CHECK (user_id = auth.uid() AND scope IN ('scope_a'::persona_scope, 'scope_b'::persona_scope));

DROP POLICY IF EXISTS rls_plan_histories_auth ON plan_histories;
CREATE POLICY rls_plan_histories_auth ON plan_histories
    FOR ALL TO authenticated
    USING (user_id = auth.uid() AND scope IN ('scope_a'::persona_scope, 'scope_b'::persona_scope))
    WITH CHECK (user_id = auth.uid() AND scope IN ('scope_a'::persona_scope, 'scope_b'::persona_scope));

DROP POLICY IF EXISTS rls_todos_auth ON todos;
CREATE POLICY rls_todos_auth ON todos
    FOR ALL TO authenticated
    USING (user_id = auth.uid() AND scope IN ('scope_a'::persona_scope, 'scope_b'::persona_scope))
    WITH CHECK (user_id = auth.uid() AND scope IN ('scope_a'::persona_scope, 'scope_b'::persona_scope));

DROP POLICY IF EXISTS rls_do_logs_auth ON do_logs;
CREATE POLICY rls_do_logs_auth ON do_logs
    FOR ALL TO authenticated
    USING (user_id = auth.uid() AND scope IN ('scope_a'::persona_scope, 'scope_b'::persona_scope))
    WITH CHECK (user_id = auth.uid() AND scope IN ('scope_a'::persona_scope, 'scope_b'::persona_scope));

DROP POLICY IF EXISTS rls_see_reviews_auth ON see_reviews;
CREATE POLICY rls_see_reviews_auth ON see_reviews
    FOR ALL TO authenticated
    USING (user_id = auth.uid() AND scope IN ('scope_a'::persona_scope, 'scope_b'::persona_scope))
    WITH CHECK (user_id = auth.uid() AND scope IN ('scope_a'::persona_scope, 'scope_b'::persona_scope));

-- 10. Idempotent Todo Completion Function
CREATE OR REPLACE FUNCTION complete_todo_idempotent(
    p_todo_id UUID,
    p_scope persona_scope,
    p_token VARCHAR,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ,
    p_actual_min INT,
    p_blocked TEXT
) RETURNS json AS $$
DECLARE
    v_todo todos%ROWTYPE;
    v_log do_logs%ROWTYPE;
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_todo FROM todos WHERE id = p_todo_id AND scope = p_scope AND user_id = v_uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Todo not found in current scope or unauthorized' USING ERRCODE = '42501';
    END IF;

    INSERT INTO do_logs (
        user_id, todo_id, scope, execution_start, execution_end,
        actual_minutes, blocked_reason, completion_token
    ) VALUES (
        v_uid, p_todo_id, p_scope, p_start, p_end,
        p_actual_min, pds_encrypt_text(p_blocked, p_scope), p_token
    )
    ON CONFLICT (todo_id, completion_token) DO NOTHING
    RETURNING * INTO v_log;

    UPDATE todos
    SET is_completed = TRUE,
        completed_at = COALESCE(v_todo.completed_at, p_end),
        updated_at = now() AT TIME ZONE 'utc'
    WHERE id = p_todo_id AND scope = p_scope AND user_id = v_uid;

    RETURN json_build_object(
        'success', true,
        'todo_id', p_todo_id,
        'is_new_log', (v_log.id IS NOT NULL)
    );
END;
$$ LANGUAGE plpgsql;

-- 11. Scope Purge Function (Full Reset for active persona only)
CREATE OR REPLACE FUNCTION purge_persona_scope(p_scope persona_scope)
RETURNS json AS $$
DECLARE
    v_deleted_plans INT;
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    DELETE FROM see_reviews WHERE scope = p_scope AND user_id = v_uid;
    DELETE FROM do_logs WHERE scope = p_scope AND user_id = v_uid;
    DELETE FROM todos WHERE scope = p_scope AND user_id = v_uid;
    DELETE FROM plan_histories WHERE scope = p_scope AND user_id = v_uid;
    DELETE FROM plans WHERE scope = p_scope AND user_id = v_uid;
    GET DIAGNOSTICS v_deleted_plans = ROW_COUNT;

    RETURN json_build_object(
        'success', true,
        'scope', p_scope,
        'purged_plans_count', v_deleted_plans
    );
END;
$$ LANGUAGE plpgsql;

-- 12. Automated Cascading Deletion Trigger (T07-C134)
CREATE OR REPLACE FUNCTION public.trigger_cascade_user_deletion()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM public.see_reviews WHERE user_id = OLD.id;
    DELETE FROM public.do_logs WHERE user_id = OLD.id;
    DELETE FROM public.todos WHERE user_id = OLD.id;
    DELETE FROM public.plan_histories WHERE user_id = OLD.id;
    DELETE FROM public.plans WHERE user_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_cascade_user_deletion ON auth.users;
CREATE TRIGGER trg_cascade_user_deletion
    AFTER DELETE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_cascade_user_deletion();
