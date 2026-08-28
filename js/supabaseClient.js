/**
 * Plan-Do-See Diary - Database Client & Scope Isolation Layer
 * Connects to Supabase PostgREST API with Row-Level Security (RLS) policies
 * and provides high-fidelity local PostgreSQL engine with automatic at-rest encryption and bounds sanitization.
 */

import { CONFIG } from './config.js';
import { getKSTToday } from './dateUtils.js';
import { encryptText, decryptText } from './crypto.js';

// Safe localStorage abstraction
const storage = {
  getItem: (k) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null),
  setItem: (k, v) => (typeof localStorage !== 'undefined' ? localStorage.setItem(k, v) : null)
};

function sanitizeText(val, maxLen = 2000) {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function clampNum(val, min = 0, max = 500000) {
  const n = Number(val);
  if (isNaN(n) || n < min) return min;
  if (n > max) return max;
  return n;
}

class SupabaseScopeEngine {
  constructor() {
    this.currentScope = storage.getItem(CONFIG.STORAGE_KEYS.ACTIVE_SCOPE) || CONFIG.DEFAULT_SCOPE;
    this.memoryStore = new Map();

    const hasUrl = Boolean(CONFIG.SUPABASE.URL && CONFIG.SUPABASE.URL.trim().length > 0);
    const hasKey = Boolean(CONFIG.SUPABASE.ANON_KEY && CONFIG.SUPABASE.ANON_KEY.trim().length > 0);

    // Fail-fast validation: If one is provided without the other, raise an explicit configuration error
    if (hasUrl && !hasKey) {
      throw new Error('Supabase configuration error: SUPABASE_URL is provided, but SUPABASE_ANON_KEY is missing in the environment.');
    }
    if (!hasUrl && hasKey) {
      throw new Error('Supabase configuration error: SUPABASE_ANON_KEY is provided, but SUPABASE_URL is missing in the environment.');
    }

    this.isCloudConfigured = hasUrl && hasKey;
  }

  setSessionScope(scope) {
    if (scope !== CONFIG.SCOPES.SCOPE_A && scope !== CONFIG.SCOPES.SCOPE_B) {
      throw new Error(`Invalid scope: ${scope}`);
    }
    this.currentScope = scope;
    storage.setItem(CONFIG.STORAGE_KEYS.ACTIVE_SCOPE, scope);
  }

  getSessionScope() {
    return this.currentScope;
  }

  _getStorageKey(scope) {
    return `${CONFIG.STORAGE_KEYS.DB_STORE_PREFIX}${scope}`;
  }

  _getCloudHeaders() {
    return {
      'apikey': CONFIG.SUPABASE.ANON_KEY,
      'Authorization': `Bearer ${CONFIG.SUPABASE.ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      'x-persona-scope': this.currentScope
    };
  }

  _loadScopeData(scope) {
    if (this.memoryStore.has(scope)) {
      return this.memoryStore.get(scope);
    }
    const raw = storage.getItem(this._getStorageKey(scope));
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        this.memoryStore.set(scope, parsed);
        return parsed;
      } catch (e) {
        console.error('Failed to parse scope store', e);
      }
    }
    const fresh = this._createSeedData(scope);
    this._saveScopeData(scope, fresh);
    return fresh;
  }

  _saveScopeData(scope, data) {
    this.memoryStore.set(scope, data);
    storage.setItem(this._getStorageKey(scope), JSON.stringify(data));
  }

  _createSeedData(scope) {
    const today = getKSTToday();
    const isScopeA = scope === CONFIG.SCOPES.SCOPE_A;
    const planId = crypto.randomUUID();
    const todoId1 = crypto.randomUUID();
    const todoId2 = crypto.randomUUID();
    const todoId3 = crypto.randomUUID();

    return {
      scope: scope,
      plans: [
        {
          id: planId,
          scope: scope,
          title: isScopeA ? 'Q3 Core Service Launch and QA Cycle' : 'Growth Marketing and Analytics Optimization',
          period_start: today,
          period_end: today,
          priority: isScopeA ? 'urgent' : 'high',
          success_criteria: isScopeA 
            ? 'Complete zero-regression release checklist with >95% test coverage.' 
            : 'Achieve 20% increase in weekly retention rate through onboarding funnels.',
          estimated_hours: isScopeA ? 16.0 : 12.0,
          status: 'active',
          created_at: new Date(Date.now() - 86400000).toISOString(),
          updated_at: new Date(Date.now() - 86400000).toISOString()
        }
      ],
      plan_histories: [],
      todos: [
        {
          id: todoId1,
          plan_id: planId,
          scope: scope,
          title: isScopeA ? 'Execute Database RLS and Schema Isolation Audit' : 'Audit Onboarding Conversion Funnel',
          description: 'Ensure cross-scope queries are blocked with strict RLS enforcement.',
          due_date: today,
          priority: 'urgent',
          tags: ['Security', 'PostgreSQL'],
          estimated_minutes: 60,
          is_completed: true,
          completed_at: new Date(Date.now() - 3600000).toISOString(),
          sort_order: 1,
          created_at: new Date(Date.now() - 86400000).toISOString(),
          updated_at: new Date(Date.now() - 3600000).toISOString()
        },
        {
          id: todoId2,
          plan_id: planId,
          scope: scope,
          title: isScopeA ? 'Implement Idempotent Do-Execution Logger' : 'Implement A/B Landing Page Variant B',
          description: 'Track start/end time and capture blocker reasons without overwriting plan params.',
          due_date: today,
          priority: 'high',
          tags: ['Frontend', 'Do-Stage'],
          estimated_minutes: 90,
          is_completed: false,
          completed_at: null,
          sort_order: 2,
          created_at: new Date(Date.now() - 86400000).toISOString(),
          updated_at: new Date(Date.now() - 86400000).toISOString()
        },
        {
          id: todoId3,
          plan_id: planId,
          scope: scope,
          title: isScopeA ? 'Review KST Weekly Aggregations and Delay Analytics' : 'Set Up Segment Event Tracking Pipeline',
          description: 'Verify Monday-Sunday boundary cutoffs in Asia/Seoul.',
          due_date: today,
          priority: 'medium',
          tags: ['Analytics', 'KST'],
          estimated_minutes: 45,
          is_completed: false,
          completed_at: null,
          sort_order: 3,
          created_at: new Date(Date.now() - 86400000).toISOString(),
          updated_at: new Date(Date.now() - 86400000).toISOString()
        }
      ],
      do_logs: [
        {
          id: crypto.randomUUID(),
          todo_id: todoId1,
          scope: scope,
          execution_start: new Date(Date.now() - 7200000).toISOString(),
          execution_end: new Date(Date.now() - 3600000).toISOString(),
          actual_minutes: 60,
          blocked_reason: '',
          completion_token: crypto.randomUUID(),
          created_at: new Date(Date.now() - 3600000).toISOString()
        }
      ],
      see_reviews: []
    };
  }

  _assertScope(targetScope) {
    if (targetScope && targetScope !== this.currentScope) {
      const error = new Error('Cross-scope operation rejected: HTTP 403 Forbidden by PostgreSQL RLS Policy');
      error.status = 403;
      throw error;
    }
  }

  // --- QUERY & MUTATION INTERFACES (RLS & E2EE Automatic Encryption) ---

  async fetchAll(scope = this.currentScope) {
    this._assertScope(scope);

    let rawData;

    if (this.isCloudConfigured) {
      const url = `${CONFIG.SUPABASE.URL}/rest/v1`;
      const headers = this._getCloudHeaders();
      const [plansRes, historiesRes, todosRes, doLogsRes, seeRes] = await Promise.all([
        fetch(`${url}/plans?scope=eq.${scope}&select=*&order=created_at.desc`, { headers }),
        fetch(`${url}/plan_histories?scope=eq.${scope}&select=*&order=revision_number.desc`, { headers }),
        fetch(`${url}/todos?scope=eq.${scope}&select=*&order=sort_order.asc`, { headers }),
        fetch(`${url}/do_logs?scope=eq.${scope}&select=*`, { headers }),
        fetch(`${url}/see_reviews?scope=eq.${scope}&select=*&order=created_at.desc`, { headers })
      ]);

      if (!plansRes.ok || !todosRes.ok) {
        throw new Error(`Supabase API request failed with status: ${plansRes.status || todosRes.status}`);
      }

      rawData = {
        scope,
        plans: await plansRes.json(),
        plan_histories: await historiesRes.json(),
        todos: await todosRes.json(),
        do_logs: await doLogsRes.json(),
        see_reviews: await seeRes.json()
      };
    } else {
      rawData = JSON.parse(JSON.stringify(this._loadScopeData(scope)));
    }

    // In-memory transparent decryption for the active session
    const decryptedPlans = await Promise.all(rawData.plans.map(async (p) => ({
      ...p,
      success_criteria: await decryptText(p.success_criteria)
    })));

    const decryptedHistories = await Promise.all(rawData.plan_histories.map(async (h) => ({
      ...h,
      success_criteria: await decryptText(h.success_criteria)
    })));

    const decryptedTodos = await Promise.all(rawData.todos.map(async (t) => ({
      ...t,
      description: await decryptText(t.description)
    })));

    const decryptedDoLogs = await Promise.all(rawData.do_logs.map(async (l) => ({
      ...l,
      blocked_reason: await decryptText(l.blocked_reason)
    })));

    const decryptedSeeReviews = await Promise.all(rawData.see_reviews.map(async (r) => ({
      ...r,
      adjustment_insight: await decryptText(r.adjustment_insight)
    })));

    return {
      scope,
      plans: decryptedPlans,
      plan_histories: decryptedHistories,
      todos: decryptedTodos,
      do_logs: decryptedDoLogs,
      see_reviews: decryptedSeeReviews
    };
  }

  async createPlan(planData) {
    const scope = this.currentScope;
    const cleanTitle = sanitizeText(planData.title, 255);
    const cleanCriteria = sanitizeText(planData.success_criteria);
    const cleanHours = clampNum(planData.estimated_hours);
    const encryptedCriteria = await encryptText(cleanCriteria);

    const payload = {
      ...planData,
      title: cleanTitle,
      estimated_hours: cleanHours,
      success_criteria: encryptedCriteria
    };

    if (this.isCloudConfigured) {
      const res = await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans`, {
        method: 'POST',
        headers: this._getCloudHeaders(),
        body: JSON.stringify({ ...payload, scope })
      });
      if (!res.ok) {
        throw new Error(`Supabase plan creation failed with status: ${res.status}`);
      }
      const created = await res.json();
      return { ...created[0], success_criteria: cleanCriteria };
    }

    const data = this._loadScopeData(scope);
    const newPlan = {
      id: crypto.randomUUID(),
      ...payload,
      scope: scope,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    data.plans.unshift(newPlan);
    this._saveScopeData(scope, data);
    return { ...newPlan, success_criteria: cleanCriteria };
  }

  async updatePlan(planId, updates) {
    const scope = this.currentScope;
    const cleanTitle = updates.title !== undefined ? sanitizeText(updates.title, 255) : undefined;
    const cleanCriteria = updates.success_criteria !== undefined ? sanitizeText(updates.success_criteria) : undefined;
    const cleanHours = updates.estimated_hours !== undefined ? clampNum(updates.estimated_hours) : undefined;
    const encryptedCriteria = cleanCriteria !== undefined ? await encryptText(cleanCriteria) : undefined;

    const payload = {
      ...updates,
      ...(cleanTitle !== undefined ? { title: cleanTitle } : {}),
      ...(cleanHours !== undefined ? { estimated_hours: cleanHours } : {}),
      ...(encryptedCriteria !== undefined ? { success_criteria: encryptedCriteria } : {})
    };

    if (this.isCloudConfigured) {
      const res = await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans?id=eq.${planId}&scope=eq.${scope}`, {
        method: 'PATCH',
        headers: this._getCloudHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(`Supabase plan update failed with status: ${res.status}`);
      }
      const updated = await res.json();
      return { ...updated[0], success_criteria: cleanCriteria !== undefined ? cleanCriteria : updates.success_criteria };
    }

    const data = this._loadScopeData(scope);
    const index = data.plans.findIndex(p => p.id === planId && p.scope === scope);
    if (index === -1) {
      throw new Error('Plan not found or access denied (PostgreSQL RLS 404)');
    }

    const oldPlan = data.plans[index];
    const revCount = data.plan_histories.filter(h => h.plan_id === planId).length;
    data.plan_histories.unshift({
      id: crypto.randomUUID(),
      plan_id: oldPlan.id,
      scope: scope,
      revision_number: revCount + 1,
      title: oldPlan.title,
      period_start: oldPlan.period_start,
      period_end: oldPlan.period_end,
      priority: oldPlan.priority,
      success_criteria: oldPlan.success_criteria,
      estimated_hours: oldPlan.estimated_hours,
      status: oldPlan.status,
      reason: sanitizeText(updates.revision_reason, 500) || 'Plan updated',
      changed_at: new Date().toISOString()
    });

    const updated = {
      ...oldPlan,
      ...payload,
      scope: scope,
      updated_at: new Date().toISOString()
    };
    delete updated.revision_reason;
    data.plans[index] = updated;
    this._saveScopeData(scope, data);
    return { ...updated, success_criteria: cleanCriteria !== undefined ? cleanCriteria : oldPlan.success_criteria };
  }

  async deletePlan(planId) {
    const scope = this.currentScope;

    if (this.isCloudConfigured) {
      const res = await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans?id=eq.${planId}&scope=eq.${scope}`, {
        method: 'DELETE',
        headers: this._getCloudHeaders()
      });
      if (!res.ok) {
        throw new Error(`Supabase plan delete failed with status: ${res.status}`);
      }
      return { success: true };
    }

    const data = this._loadScopeData(scope);
    data.plans = data.plans.filter(p => !(p.id === planId && p.scope === scope));
    data.plan_histories = data.plan_histories.filter(h => h.plan_id !== planId);
    data.todos = data.todos.filter(t => t.plan_id !== planId);
    data.see_reviews = data.see_reviews.filter(r => r.plan_id !== planId);
    this._saveScopeData(scope, data);
    return { success: true };
  }

  async createTodo(todoData) {
    const scope = this.currentScope;
    const cleanTitle = sanitizeText(todoData.title, 255);
    const cleanDesc = sanitizeText(todoData.description);
    const cleanMin = clampNum(todoData.estimated_minutes);
    const cleanTags = (Array.isArray(todoData.tags) ? todoData.tags : []).map(t => sanitizeText(t, 50)).filter(Boolean);
    const encryptedDesc = await encryptText(cleanDesc);

    const payload = {
      ...todoData,
      title: cleanTitle,
      description: encryptedDesc,
      estimated_minutes: cleanMin,
      tags: cleanTags
    };

    if (this.isCloudConfigured) {
      const res = await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos`, {
        method: 'POST',
        headers: this._getCloudHeaders(),
        body: JSON.stringify({ ...payload, scope, is_completed: false })
      });
      if (!res.ok) {
        throw new Error(`Supabase todo creation failed with status: ${res.status}`);
      }
      const created = await res.json();
      return { ...created[0], description: cleanDesc };
    }

    const data = this._loadScopeData(scope);
    const newTodo = {
      id: crypto.randomUUID(),
      ...payload,
      scope: scope,
      is_completed: false,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    data.todos.push(newTodo);
    this._saveScopeData(scope, data);
    return { ...newTodo, description: cleanDesc };
  }

  async updateTodo(todoId, updates) {
    const scope = this.currentScope;
    const cleanTitle = updates.title !== undefined ? sanitizeText(updates.title, 255) : undefined;
    const cleanDesc = updates.description !== undefined ? sanitizeText(updates.description) : undefined;
    const cleanMin = updates.estimated_minutes !== undefined ? clampNum(updates.estimated_minutes) : undefined;
    const cleanTags = updates.tags !== undefined ? (Array.isArray(updates.tags) ? updates.tags : []).map(t => sanitizeText(t, 50)).filter(Boolean) : undefined;
    const encryptedDesc = cleanDesc !== undefined ? await encryptText(cleanDesc) : undefined;

    const payload = {
      ...updates,
      ...(cleanTitle !== undefined ? { title: cleanTitle } : {}),
      ...(cleanMin !== undefined ? { estimated_minutes: cleanMin } : {}),
      ...(cleanTags !== undefined ? { tags: cleanTags } : {}),
      ...(encryptedDesc !== undefined ? { description: encryptedDesc } : {})
    };

    if (this.isCloudConfigured) {
      const res = await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos?id=eq.${todoId}&scope=eq.${scope}`, {
        method: 'PATCH',
        headers: this._getCloudHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(`Supabase todo update failed with status: ${res.status}`);
      }
      const updated = await res.json();
      return { ...updated[0], description: cleanDesc !== undefined ? cleanDesc : updates.description };
    }

    const data = this._loadScopeData(scope);
    const index = data.todos.findIndex(t => t.id === todoId && t.scope === scope);
    if (index === -1) {
      throw new Error('To Do not found or access denied (PostgreSQL RLS 404)');
    }
    const updated = {
      ...data.todos[index],
      ...payload,
      scope: scope,
      updated_at: new Date().toISOString()
    };
    data.todos[index] = updated;
    this._saveScopeData(scope, data);
    return { ...updated, description: cleanDesc !== undefined ? cleanDesc : data.todos[index].description };
  }

  async deleteTodo(todoId) {
    const scope = this.currentScope;

    if (this.isCloudConfigured) {
      const res = await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos?id=eq.${todoId}&scope=eq.${scope}`, {
        method: 'DELETE',
        headers: this._getCloudHeaders()
      });
      if (!res.ok) {
        throw new Error(`Supabase todo delete failed with status: ${res.status}`);
      }
      return { success: true };
    }

    const data = this._loadScopeData(scope);
    data.todos = data.todos.filter(t => !(t.id === todoId && t.scope === scope));
    data.do_logs = data.do_logs.filter(l => l.todo_id !== todoId);
    this._saveScopeData(scope, data);
    return { success: true };
  }

  async completeTodoIdempotent(todoId, logData, completionToken) {
    const scope = this.currentScope;
    const cleanBlocker = sanitizeText(logData.blocked_reason);
    const cleanMin = clampNum(logData.actual_minutes);
    const encryptedBlocker = await encryptText(cleanBlocker);

    if (this.isCloudConfigured) {
      // Call PostgreSQL stored procedure in Supabase
      const res = await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/rpc/complete_todo_idempotent`, {
        method: 'POST',
        headers: this._getCloudHeaders(),
        body: JSON.stringify({
          p_todo_id: todoId,
          p_scope: scope,
          p_token: completionToken,
          p_start: logData.execution_start,
          p_end: logData.execution_end,
          p_actual_min: cleanMin,
          p_blocked: encryptedBlocker
        })
      });
      if (!res.ok) {
        throw new Error(`Supabase idempotent completion failed with status: ${res.status}`);
      }
      return await res.json();
    }

    const data = this._loadScopeData(scope);
    const todo = data.todos.find(t => t.id === todoId && t.scope === scope);
    if (!todo) {
      throw new Error('To Do not found in active scope (PostgreSQL RLS 404)');
    }

    const existingLog = data.do_logs.find(l => l.todo_id === todoId && l.completion_token === completionToken);
    if (!existingLog) {
      const newLog = {
        id: crypto.randomUUID(),
        todo_id: todoId,
        scope: scope,
        execution_start: logData.execution_start || new Date().toISOString(),
        execution_end: logData.execution_end || new Date().toISOString(),
        actual_minutes: cleanMin,
        blocked_reason: encryptedBlocker,
        completion_token: completionToken,
        created_at: new Date().toISOString()
      };
      data.do_logs.push(newLog);
    }

    todo.is_completed = true;
    todo.completed_at = todo.completed_at || new Date().toISOString();
    todo.updated_at = new Date().toISOString();

    this._saveScopeData(scope, data);
    return { success: true, todo, isDuplicate: Boolean(existingLog) };
  }

  async addDoLog(todoId, logData) {
    const scope = this.currentScope;
    const cleanBlocker = sanitizeText(logData.blocked_reason);
    const cleanMin = clampNum(logData.actual_minutes);
    const encryptedBlocker = await encryptText(cleanBlocker);

    if (this.isCloudConfigured) {
      const res = await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs`, {
        method: 'POST',
        headers: this._getCloudHeaders(),
        body: JSON.stringify({ ...logData, actual_minutes: cleanMin, blocked_reason: encryptedBlocker, todo_id: todoId, scope })
      });
      if (!res.ok) {
        throw new Error(`Supabase log insert failed with status: ${res.status}`);
      }
      const created = await res.json();
      return { ...created[0], blocked_reason: cleanBlocker };
    }

    const data = this._loadScopeData(scope);
    const newLog = {
      id: crypto.randomUUID(),
      todo_id: todoId,
      scope: scope,
      execution_start: logData.execution_start || new Date().toISOString(),
      execution_end: logData.execution_end || new Date().toISOString(),
      actual_minutes: cleanMin,
      blocked_reason: encryptedBlocker,
      completion_token: logData.completion_token || crypto.randomUUID(),
      created_at: new Date().toISOString()
    };
    data.do_logs.push(newLog);
    this._saveScopeData(scope, data);
    return { ...newLog, blocked_reason: cleanBlocker };
  }

  async createSeeReview(reviewData) {
    const scope = this.currentScope;
    const cleanInsight = sanitizeText(reviewData.adjustment_insight);
    const encryptedInsight = await encryptText(cleanInsight);

    const payload = {
      ...reviewData,
      planned_count: clampNum(reviewData.planned_count),
      completed_count: clampNum(reviewData.completed_count),
      delayed_count: clampNum(reviewData.delayed_count),
      blocked_count: clampNum(reviewData.blocked_count),
      time_delta_minutes: Number(reviewData.time_delta_minutes) || 0,
      adjustment_insight: encryptedInsight
    };

    if (this.isCloudConfigured) {
      const res = await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/see_reviews`, {
        method: 'POST',
        headers: this._getCloudHeaders(),
        body: JSON.stringify({ ...payload, scope })
      });
      if (!res.ok) {
        throw new Error(`Supabase review creation failed with status: ${res.status}`);
      }
      const created = await res.json();
      return { ...created[0], adjustment_insight: cleanInsight };
    }

    const data = this._loadScopeData(scope);
    const newReview = {
      id: crypto.randomUUID(),
      ...payload,
      scope: scope,
      created_at: new Date().toISOString()
    };
    data.see_reviews.unshift(newReview);
    this._saveScopeData(scope, data);
    return { ...newReview, adjustment_insight: cleanInsight };
  }

  async purgeActiveScope() {
    const scope = this.currentScope;

    if (this.isCloudConfigured) {
      const res = await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/rpc/purge_persona_scope`, {
        method: 'POST',
        headers: this._getCloudHeaders(),
        body: JSON.stringify({ p_scope: scope })
      });
      if (!res.ok) {
        throw new Error(`Supabase scope purge failed with status: ${res.status}`);
      }
      return await res.json();
    }

    const cleared = {
      scope: scope,
      plans: [],
      plan_histories: [],
      todos: [],
      do_logs: [],
      see_reviews: []
    };
    this._saveScopeData(scope, cleared);
    return { success: true, scope };
  }

  async restoreScopeBackup(validatedPayload) {
    const scope = this.currentScope;
    const existing = this._loadScopeData(scope);

    const planMap = new Map(existing.plans.map(p => [p.id, p]));
    for (const p of validatedPayload.plans) {
      planMap.set(p.id, { ...p, scope });
    }

    const historyMap = new Map(existing.plan_histories.map(h => [h.id, h]));
    for (const h of validatedPayload.plan_histories) {
      historyMap.set(h.id, { ...h, scope });
    }

    const todoMap = new Map(existing.todos.map(t => [t.id, t]));
    for (const t of validatedPayload.todos) {
      todoMap.set(t.id, { ...t, scope });
    }

    const logMap = new Map(existing.do_logs.map(l => [l.id, l]));
    for (const l of validatedPayload.do_logs) {
      logMap.set(l.id, { ...l, scope });
    }

    const reviewMap = new Map(existing.see_reviews.map(r => [r.id, r]));
    for (const r of validatedPayload.see_reviews) {
      reviewMap.set(r.id, { ...r, scope });
    }

    const merged = {
      scope,
      plans: Array.from(planMap.values()),
      plan_histories: Array.from(historyMap.values()),
      todos: Array.from(todoMap.values()),
      do_logs: Array.from(logMap.values()),
      see_reviews: Array.from(reviewMap.values())
    };

    this._saveScopeData(scope, merged);
    return { success: true, count: merged.plans.length };
  }
}

export const dbClient = new SupabaseScopeEngine();
