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

-- 2. Create Plans Table
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
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
    execution_start TIMESTAMPTZ NOT NULL,
    execution_end TIMESTAMPTZ NOT NULL,
    actual_minutes INT NOT NULL DEFAULT 0,
    blocked_reason TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '',
    completion_token VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    CONSTRAINT uq_do_logs_todo_completion_token UNIQUE (todo_id, completion_token)
);

-- 6. Create See Reviews Table (KST Reflection & Analytics Metrics)
CREATE TABLE IF NOT EXISTS see_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
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

-- Migration safety: ensure user_id column exists if table pre-existed
DO $$ BEGIN
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
    ALTER TABLE plan_histories ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
    ALTER TABLE todos ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
    ALTER TABLE do_logs ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
    ALTER TABLE see_reviews ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN null;
END $$;

-- Indexes for high-frequency queries
CREATE INDEX IF NOT EXISTS idx_plans_user_status ON plans (user_id, status);
CREATE INDEX IF NOT EXISTS idx_plan_histories_plan ON plan_histories (plan_id, revision_number);
CREATE INDEX IF NOT EXISTS idx_todos_plan ON todos (plan_id);
CREATE INDEX IF NOT EXISTS idx_todos_due_completed ON todos (due_date, is_completed);
CREATE INDEX IF NOT EXISTS idx_do_logs_todo ON do_logs (todo_id);
CREATE INDEX IF NOT EXISTS idx_see_reviews_plan ON see_reviews (plan_id);

-- 7. pgcrypto Key Derivation & Encryption Functions (Zero Client Secrets)
CREATE OR REPLACE FUNCTION get_vault_key(p_uid UUID)
RETURNS text AS $$
BEGIN
    RETURN encode(digest('pds_vault_at_rest_' || p_uid::text, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION pds_encrypt_text(p_text TEXT, p_uid UUID)
RETURNS TEXT AS $$
BEGIN
    IF p_text IS NULL OR trim(p_text) = '' THEN
        RETURN p_text;
    END IF;
    RETURN encode(pgp_sym_encrypt(p_text, get_vault_key(p_uid)), 'base64');
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION pds_decrypt_text(p_ciphertext TEXT, p_uid UUID)
RETURNS TEXT AS $$
BEGIN
    IF p_ciphertext IS NULL OR trim(p_ciphertext) = '' THEN
        RETURN p_ciphertext;
    END IF;
    BEGIN
        RETURN pgp_sym_decrypt(decode(p_ciphertext, 'base64'), get_vault_key(p_uid));
    EXCEPTION WHEN OTHERS THEN
        RETURN p_ciphertext;
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
        user_id, plan_id, revision_number, title,
        period_start, period_end, priority,
        success_criteria, estimated_hours, status,
        reason, changed_at
    ) VALUES (
        OLD.user_id, OLD.id, next_rev, OLD.title,
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

-- Enable RLS on all tables
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE do_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE see_reviews ENABLE ROW LEVEL SECURITY;

-- Clean up any legacy or permissive policies
DROP POLICY IF EXISTS "Public access" ON plans;
DROP POLICY IF EXISTS "Allow all" ON plans;
DROP POLICY IF EXISTS "Enable read access for all users" ON plans;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON plans;
DROP POLICY IF EXISTS rls_plans_auth ON plans;

DROP POLICY IF EXISTS "Public access" ON plan_histories;
DROP POLICY IF EXISTS "Allow all" ON plan_histories;
DROP POLICY IF EXISTS rls_plan_histories_auth ON plan_histories;

DROP POLICY IF EXISTS "Public access" ON todos;
DROP POLICY IF EXISTS "Allow all" ON todos;
DROP POLICY IF EXISTS rls_todos_auth ON todos;

DROP POLICY IF EXISTS "Public access" ON do_logs;
DROP POLICY IF EXISTS "Allow all" ON do_logs;
DROP POLICY IF EXISTS rls_do_logs_auth ON do_logs;

DROP POLICY IF EXISTS "Public access" ON see_reviews;
DROP POLICY IF EXISTS "Allow all" ON see_reviews;
DROP POLICY IF EXISTS rls_see_reviews_auth ON see_reviews;

-- Strict User-Isolation Policies (FOR ALL covers SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY rls_plans_auth ON plans
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY rls_plan_histories_auth ON plan_histories
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY rls_todos_auth ON todos
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY rls_do_logs_auth ON do_logs
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY rls_see_reviews_auth ON see_reviews
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- 10. Idempotent Todo Completion Function
CREATE OR REPLACE FUNCTION complete_todo_idempotent(
    p_todo_id UUID,
    p_token VARCHAR,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ,
    p_actual_min INT,
    p_blocked TEXT,
    p_memo TEXT DEFAULT ''
) RETURNS json AS $$
DECLARE
    v_todo todos%ROWTYPE;
    v_log do_logs%ROWTYPE;
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_todo FROM todos WHERE id = p_todo_id AND user_id = v_uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Todo not found or unauthorized' USING ERRCODE = '42501';
    END IF;

    INSERT INTO do_logs (
        user_id, todo_id, execution_start, execution_end,
        actual_minutes, blocked_reason, memo, completion_token
    ) VALUES (
        v_uid, p_todo_id, p_start, p_end,
        p_actual_min, pds_encrypt_text(p_blocked, v_uid), pds_encrypt_text(p_memo, v_uid), p_token
    )
    ON CONFLICT (todo_id, completion_token) DO NOTHING
    RETURNING * INTO v_log;

    UPDATE todos
    SET is_completed = TRUE,
        completed_at = COALESCE(v_todo.completed_at, p_end),
        updated_at = now() AT TIME ZONE 'utc'
    WHERE id = p_todo_id AND user_id = v_uid;

    RETURN json_build_object(
        'success', true,
        'todo_id', p_todo_id,
        'is_new_log', (v_log.id IS NOT NULL)
    );
END;
$$ LANGUAGE plpgsql;

-- 11. User Data Purge Function (Full Reset for active user only)
CREATE OR REPLACE FUNCTION purge_user_data()
RETURNS json AS $$
DECLARE
    v_deleted_plans INT;
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    DELETE FROM see_reviews WHERE user_id = v_uid;
    DELETE FROM do_logs WHERE user_id = v_uid;
    DELETE FROM todos WHERE user_id = v_uid;
    DELETE FROM plan_histories WHERE user_id = v_uid;
    DELETE FROM plans WHERE user_id = v_uid;
    GET DIAGNOSTICS v_deleted_plans = ROW_COUNT;

    RETURN json_build_object(
        'success', true,
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
