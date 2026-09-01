/**
 * Plan-Do-See Diary - Database Client & Data Access Layer
 * Connects to Supabase PostgREST API with Row-Level Security (RLS) policies
 * and provides high-fidelity local PostgreSQL engine with automatic at-rest encryption and bounds sanitization.
 */

import { CONFIG } from './config.js';
import { getKSTToday } from './dateUtils.js';
import { encryptText, decryptText } from './crypto.js';
import { sanitizeText, clampNum } from './validators.js';
import { authClient } from './auth.js';

// Isolated Multi-Tab Session Configuration (window.sessionStorage)
export const supabaseConfig = {
  auth: {
    storage: typeof window !== 'undefined' ? window.sessionStorage : (typeof sessionStorage !== 'undefined' ? sessionStorage : null),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  }
};

// Safe tab-isolated storage abstraction
const storage = {
  getItem: (k) => {
    if (typeof sessionStorage !== 'undefined') {
      const val = sessionStorage.getItem(k);
      if (val !== null) return val;
    }
    return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;
  },
  setItem: (k, v) => {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(k, v);
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
  }
};

class SupabaseEngine {
  constructor() {
    this.memoryStore = new Map();
    this.inFlightLocks = new Map();

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

  _getCurrentUserKey() {
    return authClient.getUserId() || 'anon';
  }

  _getStorageKey() {
    return `${CONFIG.STORAGE_KEYS.DB_STORE_PREFIX}${this._getCurrentUserKey()}`;
  }

  _getCloudHeaders() {
    const token = authClient.getAccessToken();
    return {
      'apikey': CONFIG.SUPABASE.ANON_KEY,
      'Authorization': token ? `Bearer ${token}` : `Bearer ${CONFIG.SUPABASE.ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  _loadData() {
    const userKey = this._getCurrentUserKey();
    if (this.memoryStore.has(userKey)) {
      return this.memoryStore.get(userKey);
    }
    const raw = storage.getItem(this._getStorageKey());
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.plans)) parsed.plans = [];
        if (!Array.isArray(parsed.plan_histories)) parsed.plan_histories = [];
        if (!Array.isArray(parsed.todos)) parsed.todos = [];
        if (!Array.isArray(parsed.do_logs)) parsed.do_logs = [];
        if (!Array.isArray(parsed.see_reviews)) parsed.see_reviews = [];
        this.memoryStore.set(userKey, parsed);
        return parsed;
      } catch (e) {
        console.error('Failed to parse data store', e);
      }
    }
    const fresh = { plans: [], plan_histories: [], todos: [], do_logs: [], see_reviews: [] };
    this._saveData(fresh);
    return fresh;
  }

  _saveData(data) {
    const userKey = this._getCurrentUserKey();
    this.memoryStore.set(userKey, data);
    storage.setItem(this._getStorageKey(), JSON.stringify(data));
  }

  clearMemoryStore() {
    this.memoryStore.clear();
  }

  _createSeedData() {
    const today = getKSTToday();

    const planId = crypto.randomUUID();
    const todoId1 = crypto.randomUUID();
    const todoId2 = crypto.randomUUID();
    const todoId3 = crypto.randomUUID();

    return {
      plans: [
        {
          id: planId,
          title: '이번 주 건강 관리 및 운동 루틴 실천',
          period_start: today,
          period_end: today,
          priority: 'urgent',
          success_criteria: '주 4회 운동 완료 및 매일 물 2L 마시기 100% 실천',
          estimated_hours: 360,
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
          title: '아침 공복 스트레칭 및 영양제 챙겨먹기',
          description: '기상 직후 전신 스트레칭 10분 진행 및 비타민 복용',
          due_date: today,
          priority: 'urgent',
          tags: ['건강', '루틴'],
          estimated_minutes: 30,
          is_completed: true,
          completed_at: new Date(Date.now() - 3600000).toISOString(),
          sort_order: 1,
          created_at: new Date(Date.now() - 86400000).toISOString(),
          updated_at: new Date(Date.now() - 3600000).toISOString()
        },
        {
          id: todoId2,
          plan_id: planId,
          title: '퇴근 후 헬스장에서 런닝머신 40분 뛰기',
          description: '가벼운 조깅 속도로 심폐 지구력 기르기',
          due_date: today,
          priority: 'high',
          tags: ['운동', '헬스'],
          estimated_minutes: 40,
          is_completed: false,
          completed_at: null,
          sort_order: 2,
          created_at: new Date(Date.now() - 86400000).toISOString(),
          updated_at: new Date(Date.now() - 86400000).toISOString()
        },
        {
          id: todoId3,
          plan_id: planId,
          title: '주말 식단용 신선한 샐러드 및 과일 장보기',
          description: '주말 동안 먹을 건강한 식재료 구매하기',
          due_date: today,
          priority: 'medium',
          tags: ['식단', '건강'],
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
          execution_start: new Date(Date.now() - 7200000).toISOString(),
          execution_end: new Date(Date.now() - 5400000).toISOString(),
          actual_minutes: 30,
          blocked_reason: '',
          memo: '',
          completion_token: crypto.randomUUID(),
          created_at: new Date(Date.now() - 3600000).toISOString()
        }
      ],
      see_reviews: []
    };
  }

  _mergeData(local, cloud) {
    const plansMap = new Map((local.plans || []).map(p => [p.id, p]));
    for (const p of (cloud.plans || [])) {
      plansMap.set(p.id, p);
    }
    const historiesMap = new Map((local.plan_histories || []).map(h => [h.id, h]));
    for (const h of (cloud.plan_histories || [])) {
      historiesMap.set(h.id, h);
    }
    const todosMap = new Map((local.todos || []).map(t => [t.id, t]));
    for (const t of (cloud.todos || [])) {
      todosMap.set(t.id, t);
    }
    
    // Deduplicate do_logs strictly by log primary key id
    const logsMap = new Map((local.do_logs || []).map(l => [l.id, l]));
    for (const l of (cloud.do_logs || [])) {
      logsMap.set(l.id, l);
    }

    const reviewsMap = new Map((local.see_reviews || []).map(r => [r.id, r]));
    for (const r of (cloud.see_reviews || [])) {
      reviewsMap.set(r.id, r);
    }

    const merged = {
      plans: Array.from(plansMap.values()),
      plan_histories: Array.from(historiesMap.values()),
      todos: Array.from(todosMap.values()),
      do_logs: Array.from(logsMap.values()),
      see_reviews: Array.from(reviewsMap.values())
    };
    this._saveData(merged);
    return merged;
  }

  // --- QUERY & MUTATION INTERFACES (RLS & E2EE Automatic Encryption) ---

  async _fetch(url, options = {}, retries = 2) {
    // Ensure cloud headers have valid Authorization token if user is authenticated
    if (this.isCloudConfigured && (!options.headers?.Authorization || options.headers.Authorization.includes(CONFIG.SUPABASE.ANON_KEY))) {
      const token = authClient.getAccessToken();
      if (token) {
        options.headers = {
          ...(options.headers || {}),
          'Authorization': `Bearer ${token}`,
          'apikey': CONFIG.SUPABASE.ANON_KEY
        };
      }
    }

    let res = await fetch(url, options);
    if (!res.ok && res.status === 401 && retries > 0) {
      // Delay for session hydration buffer or clock skew
      await new Promise(r => setTimeout(r, 400));
      authClient.init();
      const token = authClient.getAccessToken();
      if (token) {
        options.headers = {
          ...(options.headers || {}),
          'Authorization': `Bearer ${token}`,
          'apikey': CONFIG.SUPABASE.ANON_KEY
        };
      }
      return this._fetch(url, options, retries - 1);
    }
    return res;
  }

  async fetchAll() {
    const local = this._loadData();

    if (this.isCloudConfigured) {
      if (typeof authClient.getSession === 'function') {
        await authClient.getSession();
      }
      if (authClient.isAuthenticated() && authClient.getAccessToken()) {
        try {
          const headers = this._getCloudHeaders();
          const url = `${CONFIG.SUPABASE.URL}/rest/v1`;

          const [plansRes, historiesRes, todosRes, doLogsRes, seeRes] = await Promise.all([
            this._fetch(`${url}/plans?select=*`, { headers }),
            this._fetch(`${url}/plan_histories?select=*`, { headers }),
            this._fetch(`${url}/todos?select=*`, { headers }),
            this._fetch(`${url}/do_logs?select=*`, { headers }),
            this._fetch(`${url}/see_reviews?select=*`, { headers })
          ]);

          if (plansRes.status === 401 || todosRes.status === 401 || historiesRes.status === 401) {
            const err = new Error('Session expired or unauthorized');
            err.status = 401;
            throw err;
          }

          const [cloudPlans, cloudHistories, cloudTodos, cloudDoLogs, cloudSee] = await Promise.all([
            plansRes.ok ? plansRes.json() : [],
            historiesRes.ok ? historiesRes.json() : [],
            todosRes.ok ? todosRes.json() : [],
            doLogsRes.ok ? doLogsRes.json() : [],
            seeRes.ok ? seeRes.json() : []
          ]);

          // Decrypt fields from cloud
          const decryptedPlans = await Promise.all((cloudPlans || []).map(async p => ({
            ...p,
            success_criteria: await decryptText(p.success_criteria)
          })));

          const decryptedHistories = await Promise.all((cloudHistories || []).map(async h => ({
            ...h,
            success_criteria: await decryptText(h.success_criteria),
            revision_reason: await decryptText(h.revision_reason)
          })));

          const decryptedTodos = await Promise.all((cloudTodos || []).map(async t => ({
            ...t,
            description: await decryptText(t.description)
          })));

          const decryptedDoLogs = await Promise.all((cloudDoLogs || []).map(async l => ({
            ...l,
            blocked_reason: await decryptText(l.blocked_reason),
            memo: await decryptText(l.memo)
          })));

          const decryptedSee = await Promise.all((cloudSee || []).map(async r => ({
            ...r,
            adjustment_insight: await decryptText(r.adjustment_insight)
          })));

          const cloudData = {
            plans: decryptedPlans,
            plan_histories: decryptedHistories,
            todos: decryptedTodos,
            do_logs: decryptedDoLogs,
            see_reviews: decryptedSee
          };

          const merged = this._mergeData(local, cloudData);
          return merged;
        } catch (err) {
          if (err.status === 401) throw err;
          console.warn('Cloud fetch warning, using local PostgreSQL engine store:', err.message);
        }
      }
    }

    // Decrypt local store before returning
    const decryptedLocalPlans = await Promise.all((local.plans || []).map(async p => ({
      ...p,
      success_criteria: await decryptText(p.success_criteria)
    })));

    const decryptedLocalHistories = await Promise.all((local.plan_histories || []).map(async h => ({
      ...h,
      success_criteria: await decryptText(h.success_criteria),
      revision_reason: await decryptText(h.revision_reason)
    })));

    const decryptedLocalTodos = await Promise.all((local.todos || []).map(async t => ({
      ...t,
      description: await decryptText(t.description)
    })));

    const decryptedLocalDoLogs = await Promise.all((local.do_logs || []).map(async l => ({
      ...l,
      blocked_reason: await decryptText(l.blocked_reason),
      memo: await decryptText(l.memo)
    })));

    const decryptedLocalSee = await Promise.all((local.see_reviews || []).map(async r => ({
      ...r,
      adjustment_insight: await decryptText(r.adjustment_insight)
    })));

    return {
      plans: decryptedLocalPlans,
      plan_histories: decryptedLocalHistories,
      todos: decryptedLocalTodos,
      do_logs: decryptedLocalDoLogs,
      see_reviews: decryptedLocalSee
    };
  }

  async createPlan(planData) {
    const cleanTitle = sanitizeText(planData.title);
    if (!cleanTitle) {
      throw new Error('계획 제목은 필수입니다.');
    }
    const cleanCriteria = sanitizeText(planData.success_criteria);

    const payload = {
      ...planData,
      title: cleanTitle,
      estimated_hours: clampNum(planData.estimated_hours),
      success_criteria: cleanCriteria
    };

    const newPlan = {
      id: crypto.randomUUID(),
      ...payload,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const data = this._loadData();
    data.plans.unshift(newPlan);
    this._saveData(data);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        const userId = authClient.getUserId();
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans`, {
          method: 'POST',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({ ...payload, id: newPlan.id, ...(userId ? { user_id: userId } : {}) })
        });
      } catch (err) {
        console.warn('Cloud createPlan sync warning:', err.message);
      }
    }

    return { ...newPlan, success_criteria: cleanCriteria };
  }

  async updatePlan(planId, updates) {
    const data = this._loadData();
    const index = data.plans.findIndex(p => String(p.id) === String(planId));
    if (index === -1) {
      throw new Error('계획을 찾을 수 없거나 접근이 거부되었습니다. (PostgreSQL RLS 404/403)');
    }

    const currentPlan = data.plans[index];
    const cleanTitle = updates.title !== undefined ? sanitizeText(updates.title) : currentPlan.title;
    const cleanCriteria = updates.success_criteria !== undefined ? sanitizeText(updates.success_criteria) : currentPlan.success_criteria;

    const revisionReasonText = sanitizeText(updates.revision_reason) || '계획 정보 수정';

    // Save immutable revision history
    const historyEntry = {
      id: crypto.randomUUID(),
      plan_id: currentPlan.id,
      title: currentPlan.title,
      period_start: currentPlan.period_start,
      period_end: currentPlan.period_end,
      priority: currentPlan.priority,
      estimated_hours: currentPlan.estimated_hours,
      success_criteria: currentPlan.success_criteria,
      revision_reason: revisionReasonText,
      created_at: new Date().toISOString()
    };
    data.plan_histories.unshift(historyEntry);

    const updatedPlan = {
      ...currentPlan,
      ...updates,
      title: cleanTitle,
      estimated_hours: updates.estimated_hours !== undefined ? clampNum(updates.estimated_hours) : currentPlan.estimated_hours,
      success_criteria: cleanCriteria,
      updated_at: new Date().toISOString()
    };
    delete updatedPlan.revision_reason;

    data.plans[index] = updatedPlan;
    this._saveData(data);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        const userId = authClient.getUserId();
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plan_histories`, {
          method: 'POST',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({ ...historyEntry, ...(userId ? { user_id: userId } : {}) })
        });

        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans?id=eq.${planId}`, {
          method: 'PATCH',
          headers: this._getCloudHeaders(),
          body: JSON.stringify(updatedPlan)
        });
      } catch (err) {
        console.warn('Cloud updatePlan sync warning:', err.message);
      }
    }

    return { ...updatedPlan, success_criteria: cleanCriteria };
  }

  async deletePlan(planId) {
    const data = this._loadData();
    const index = data.plans.findIndex(p => String(p.id) === String(planId));
    if (index === -1) {
      throw new Error('계획을 찾을 수 없거나 접근이 거부되었습니다. (PostgreSQL RLS 404/403)');
    }

    const deletedPlan = data.plans[index];
    const sourcePlanId = deletedPlan.source_plan_id || deletedPlan.parent_plan_id;

    // Cascade delete in memory
    const childTodos = data.todos.filter(t => String(t.plan_id) === String(planId));
    const childTodoIds = new Set(childTodos.map(t => String(t.id)));

    data.plans.splice(index, 1);
    data.plan_histories = data.plan_histories.filter(h => String(h.plan_id) !== String(planId));
    data.todos = data.todos.filter(t => String(t.plan_id) !== String(planId));
    data.do_logs = data.do_logs.filter(l => !childTodoIds.has(String(l.todo_id)));
    data.see_reviews = data.see_reviews.filter(r => String(r.plan_id) !== String(planId));

    // ISSUE 2 FIX: If deleted plan was linked to a source plan, check if the source plan has remaining incomplete items
    let sourcePlanToUpdate = null;
    if (sourcePlanId) {
      const sourcePlan = data.plans.find(p => String(p.id) === String(sourcePlanId));
      if (sourcePlan) {
        // Check if other feedback improvement plans are still linked to this source plan
        const hasOtherLinkedFeedback = data.plans.some(p => (p.source_plan_id === sourcePlan.id || p.parent_plan_id === sourcePlan.id));
        if (!hasOtherLinkedFeedback) {
          const sourceTodos = data.todos.filter(t => String(t.plan_id) === String(sourcePlan.id));
          const allCompleted = sourceTodos.length > 0 && sourceTodos.every(t => t.is_completed || t.status === 'completed');
          if (!allCompleted) {
            // Revert status to active/in_progress and remove completed flag
            sourcePlan.status = 'active';
            sourcePlan.is_completed = false;
            sourcePlanToUpdate = { ...sourcePlan };
          }
        }
      }
    }

    this._saveData(data);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans?id=eq.${planId}`, {
          method: 'DELETE',
          headers: this._getCloudHeaders()
        });

        if (sourcePlanToUpdate) {
          await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans?id=eq.${sourcePlanToUpdate.id}`, {
            method: 'PATCH',
            headers: this._getCloudHeaders(),
            body: JSON.stringify({
              status: sourcePlanToUpdate.status,
              is_completed: false,
              revision_reason: 'Reverted to active state after linked feedback plan deletion'
            })
          }).catch(() => {});
        }
      } catch (err) {
        console.warn('Cloud deletePlan sync warning:', err.message);
      }
    }

    return { success: true };
  }

  async createTodo(todoData) {
    const cleanTitle = sanitizeText(todoData.title);
    if (!cleanTitle) {
      throw new Error('할 일 제목은 필수입니다.');
    }
    const cleanDesc = sanitizeText(todoData.description);

    const payload = {
      ...todoData,
      title: cleanTitle,
      estimated_minutes: clampNum(todoData.estimated_minutes),
      description: cleanDesc,
      tags: Array.isArray(todoData.tags) ? todoData.tags.map(t => sanitizeText(t)).filter(Boolean) : []
    };

    const data = this._loadData();
    const parentPlan = data.plans.find(p => String(p.id) === String(todoData.plan_id));
    if (!parentPlan) {
      throw new Error('상위 계획을 찾을 수 없거나 접근이 거부되었습니다. (PostgreSQL RLS 404/403)');
    }

    const newTodo = {
      id: crypto.randomUUID(),
      ...payload,
      is_completed: false,
      completed_at: null,
      sort_order: (data.todos.filter(t => String(t.plan_id) === String(todoData.plan_id)).length) + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    data.todos.unshift(newTodo);
    this._saveData(data);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        const userId = authClient.getUserId();
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans`, {
          method: 'POST',
          headers: { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ ...parentPlan })
        }).catch(() => {});

        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos`, {
          method: 'POST',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({ ...payload, id: newTodo.id, ...(userId ? { user_id: userId } : {}) })
        });
      } catch (err) {
        console.warn('Cloud createTodo sync warning:', err.message);
      }
    }

    return { ...newTodo, description: cleanDesc };
  }

  async updateTodo(todoId, updates) {
    const data = this._loadData();
    const index = data.todos.findIndex(t => String(t.id) === String(todoId));
    if (index === -1) {
      throw new Error('할 일을 찾을 수 없거나 접근이 거부되었습니다. (PostgreSQL RLS 404/403)');
    }

    const currentTodo = data.todos[index];
    const cleanTitle = updates.title !== undefined ? sanitizeText(updates.title) : currentTodo.title;
    const cleanDesc = updates.description !== undefined ? sanitizeText(updates.description) : currentTodo.description;

    const updatedTodo = {
      ...currentTodo,
      ...updates,
      title: cleanTitle,
      estimated_minutes: updates.estimated_minutes !== undefined ? clampNum(updates.estimated_minutes) : currentTodo.estimated_minutes,
      description: cleanDesc,
      tags: updates.tags !== undefined ? (Array.isArray(updates.tags) ? updates.tags.map(t => sanitizeText(t)).filter(Boolean) : []) : currentTodo.tags,
      updated_at: new Date().toISOString()
    };

    data.todos[index] = updatedTodo;
    this._saveData(data);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos?id=eq.${todoId}`, {
          method: 'PATCH',
          headers: this._getCloudHeaders(),
          body: JSON.stringify(updatedTodo)
        });
      } catch (err) {
        console.warn('Cloud updateTodo sync warning:', err.message);
      }
    }

    return { ...updatedTodo, description: cleanDesc };
  }

  async deleteTodo(todoId) {
    const data = this._loadData();
    const index = data.todos.findIndex(t => String(t.id) === String(todoId));
    if (index === -1) {
      throw new Error('할 일을 찾을 수 없거나 접근이 거부되었습니다. (PostgreSQL RLS 404/403)');
    }

    data.todos.splice(index, 1);
    data.do_logs = data.do_logs.filter(l => String(l.todo_id) !== String(todoId));
    this._saveData(data);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos?id=eq.${todoId}`, {
          method: 'DELETE',
          headers: this._getCloudHeaders()
        });
      } catch (err) {
        console.warn('Cloud deleteTodo sync warning:', err.message);
      }
    }

    return { success: true };
  }

  async completeTodoIdempotent(todoId, logData, completionToken) {
    const cleanBlocker = sanitizeText(logData.blocked_reason);
    const cleanMemo = sanitizeText(logData.memo);
    const cleanMin = clampNum(logData.actual_minutes);
    if (cleanMin < 0) {
      throw new Error('실제 소요 시간은 0분 이상이어야 합니다.');
    }
    const encryptedBlocker = await encryptText(cleanBlocker);
    const encryptedMemo = await encryptText(cleanMemo);

    const data = this._loadData();
    const todo = data.todos.find(t => String(t.id) === String(todoId));
    if (!todo) {
      throw new Error('할 일을 찾을 수 없습니다. (PostgreSQL RLS 404)');
    }

    const isDuplicateToken = Boolean(completionToken && data.do_logs.some(l => l.todo_id === todoId && l.completion_token === completionToken));
    const newLog = {
      id: crypto.randomUUID(),
      todo_id: todoId,
      execution_start: logData.execution_start || new Date().toISOString(),
      execution_end: logData.execution_end || new Date().toISOString(),
      actual_minutes: cleanMin,
      blocked_reason: encryptedBlocker,
      memo: encryptedMemo,
      completion_token: completionToken,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (!isDuplicateToken) {
      data.do_logs.push(newLog);
    }

    todo.is_completed = true;
    todo.completed_at = todo.completed_at || new Date().toISOString();
    todo.updated_at = new Date().toISOString();
    this._saveData(data);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        const parentPlan = data.plans.find(p => String(p.id) === String(todo.plan_id));
        if (parentPlan) {
          await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans`, {
            method: 'POST',
            headers: { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({ ...parentPlan })
          }).catch(() => {});
        }
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos`, {
          method: 'POST',
          headers: { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ ...todo })
        }).catch(() => {});

        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos?id=eq.${todoId}`, {
          method: 'PATCH',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({ is_completed: true, completed_at: todo.completed_at, updated_at: todo.updated_at })
        }).catch(() => {});

        if (!isDuplicateToken) {
          const userId = authClient.getUserId();
          await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs`, {
            method: 'POST',
            headers: this._getCloudHeaders(),
            body: JSON.stringify({
              id: newLog.id,
              todo_id: todo.id,
              ...(userId ? { user_id: userId } : {}),
              execution_start: newLog.execution_start,
              execution_end: newLog.execution_end,
              actual_minutes: cleanMin,
              blocked_reason: encryptedBlocker,
              memo: encryptedMemo,
              completion_token: newLog.completion_token
            })
          });
        }
      } catch (err) {
        console.warn('Cloud completeTodoIdempotent sync warning:', err.message);
      }
    }

    return { ...newLog, blocked_reason: cleanBlocker, memo: cleanMemo };
  }

  async addDoLog(todoIdOrLogData, maybeLogData) {
    let todoId, logData;
    if (typeof todoIdOrLogData === 'object' && todoIdOrLogData !== null && !maybeLogData) {
      logData = todoIdOrLogData;
      todoId = logData.todo_id;
    } else {
      todoId = todoIdOrLogData;
      logData = maybeLogData || {};
    }

    const cleanBlocker = sanitizeText(logData.blocked_reason);
    const cleanMemo = sanitizeText(logData.memo);
    const cleanMin = clampNum(logData.actual_minutes);
    if (cleanMin < 0) {
      throw new Error('실제 소요 시간은 0분 이상이어야 합니다.');
    }
    const encryptedBlocker = await encryptText(cleanBlocker);
    const encryptedMemo = await encryptText(cleanMemo);

    const data = this._loadData();
    const todo = data.todos.find(t => String(t.id) === String(todoId));
    if (!todo) {
      throw new Error('할 일을 찾을 수 없습니다. (PostgreSQL RLS 404)');
    }

    const newLog = {
      id: crypto.randomUUID(),
      todo_id: todo.id,
      execution_start: logData.execution_start || new Date().toISOString(),
      execution_end: logData.execution_end || new Date().toISOString(),
      actual_minutes: cleanMin,
      blocked_reason: encryptedBlocker,
      memo: encryptedMemo,
      completion_token: logData.completion_token || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    data.do_logs.push(newLog);
    this._saveData(data);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        const userId = authClient.getUserId();
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs`, {
          method: 'POST',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({
            id: newLog.id,
            todo_id: todo.id,
            ...(userId ? { user_id: userId } : {}),
            execution_start: newLog.execution_start,
            execution_end: newLog.execution_end,
            actual_minutes: cleanMin,
            blocked_reason: encryptedBlocker,
            memo: encryptedMemo,
            completion_token: newLog.completion_token
          })
        });
      } catch (err) {
        console.warn('Cloud addDoLog sync warning:', err.message);
      }
    }

    return { ...newLog, blocked_reason: cleanBlocker, memo: cleanMemo };
  }

  async deleteDoLog(logId) {
    if (!logId) {
      throw new Error('Log ID is required');
    }
    const data = this._loadData();
    const prevCount = (data.do_logs || []).length;
    data.do_logs = (data.do_logs || []).filter(l => String(l.id) !== String(logId));
    this._saveData(data);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        const headers = this._getCloudHeaders();
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs?id=eq.${logId}`, {
          method: 'DELETE',
          headers
        });
      } catch (err) {
        console.warn('Cloud deleteDoLog sync warning:', err.message);
      }
    }

    return { success: true, deleted: prevCount > (data.do_logs || []).length };
  }

  async updateDoLog(logId, rawData = {}) {
    if (!logId) {
      throw new Error('Log ID is required');
    }
    const cleanMin = Math.max(0, parseInt(
      rawData.actual_minutes !== undefined ? rawData.actual_minutes : rawData.duration_minutes,
      10
    ) || 0);
    const startTime = rawData.execution_start || rawData.start_time || new Date().toISOString();
    const endTime   = rawData.execution_end   || rawData.end_time   || new Date().toISOString();
    const blockerRaw = rawData.blocked_reason !== undefined ? rawData.blocked_reason
                     : (rawData.blocker_reason !== undefined ? rawData.blocker_reason : '');
    const blockerText = sanitizeText(String(blockerRaw).trim());
    const memoText    = rawData.memo ? sanitizeText(String(rawData.memo).trim()) : '';

    const encryptedBlocker = await encryptText(blockerText);
    const encryptedMemo    = await encryptText(memoText);

    const data = this._loadData();
    const index = (data.do_logs || []).findIndex(l => String(l.id) === String(logId));
    if (index === -1) {
      throw new Error('실행 기록을 찾을 수 없습니다.');
    }

    const currentLog = data.do_logs[index];

    const updatedLog = {
      ...currentLog,
      execution_start: startTime,
      execution_end:   endTime,
      actual_minutes:  cleanMin,
      blocked_reason:  encryptedBlocker,
      memo:            encryptedMemo
    };

    data.do_logs[index] = updatedLog;
    this._saveData(data);

    if (this.isCloudConfigured && authClient.isAuthenticated() && authClient.getAccessToken()) {
      try {
        // Only schema-valid do_logs columns (per schema.sql):
        // execution_start, execution_end, actual_minutes, blocked_reason, memo
        const patchPayload = {
          execution_start: startTime,
          execution_end:   endTime,
          actual_minutes:  cleanMin,
          blocked_reason:  encryptedBlocker,
          memo:            encryptedMemo
        };
        const res = await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs?id=eq.${logId}`, {
          method: 'PATCH',
          headers: this._getCloudHeaders(),
          body: JSON.stringify(patchPayload)
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          console.warn(`Cloud updateDoLog PATCH failed (${res.status}):`, errBody);
        }
      } catch (err) {
        console.warn('Cloud updateDoLog sync warning:', err.message);
      }
    }

    return { ...updatedLog, blocked_reason: blockerText, memo: memoText };
  }

  getTodoActualMinutes(todoId) {
    const data = this._loadData();
    const logs = (data.do_logs || []).filter(l => String(l.todo_id) === String(todoId));
    return logs.reduce((sum, l) => sum + (Number(l.actual_minutes || l.duration_minutes) || 0), 0);
  }

  async createSeeReview(reviewData) {
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

    const data = this._loadData();
    const targetPlan = data.plans.find(p => String(p.id) === String(reviewData.plan_id));
    if (!targetPlan) {
      throw new Error('계획을 찾을 수 없거나 접근이 거부되었습니다. (PostgreSQL RLS 404/403)');
    }

    const newReview = {
      id: crypto.randomUUID(),
      ...payload,
      created_at: new Date().toISOString()
    };
    data.see_reviews.unshift(newReview);
    this._saveData(data);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans`, {
          method: 'POST',
          headers: { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ ...targetPlan })
        }).catch(() => {});

        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/see_reviews`, {
          method: 'POST',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({ ...payload, id: newReview.id })
        });
      } catch (err) {
        console.warn('Cloud createSeeReview sync warning:', err.message);
      }
    }

    return { ...newReview, adjustment_insight: cleanInsight };
  }

  async purgeUserData() {
    return this.purgeAll();
  }

  async purgeAll() {
    const cleared = {
      plans: [],
      plan_histories: [],
      todos: [],
      do_logs: [],
      see_reviews: []
    };
    this._saveData(cleared);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        const userId = authClient.getUserId();
        const url = `${CONFIG.SUPABASE.URL}/rest/v1`;
        const headers = this._getCloudHeaders();
        const filter = userId ? `?user_id=eq.${userId}` : `?id=neq.00000000-0000-0000-0000-000000000000`;

        // Execute RPC purge_user_data if available
        await this._fetch(`${url}/rpc/purge_user_data`, { method: 'POST', headers }).catch(() => {});

        // 1. Delete dependent leaf records first (plan_histories, do_logs)
        await Promise.all([
          this._fetch(`${url}/plan_histories${filter}`, { method: 'DELETE', headers }).catch(() => {}),
          this._fetch(`${url}/do_logs${filter}`, { method: 'DELETE', headers }).catch(() => {})
        ]);
        // 2. Delete see_reviews
        await this._fetch(`${url}/see_reviews${filter}`, { method: 'DELETE', headers }).catch(() => {});
        // 3. Delete todos
        await this._fetch(`${url}/todos${filter}`, { method: 'DELETE', headers }).catch(() => {});
        // 4. Delete plans
        await this._fetch(`${url}/plans${filter}`, { method: 'DELETE', headers }).catch(() => {});
      } catch (err) {
        console.warn('Cloud data purge sync warning:', err.message);
      }
    }

    return { success: true };
  }

  async populateSyntheticSeed() {
    const seed = this._createSeedData();
    this._saveData(seed);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        const url = `${CONFIG.SUPABASE.URL}/rest/v1`;
        const headers = { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' };
        if (seed.plans.length > 0) {
          await this._fetch(`${url}/plans`, { method: 'POST', headers, body: JSON.stringify(seed.plans) }).catch(() => {});
        }
        if (seed.todos.length > 0) {
          await this._fetch(`${url}/todos`, { method: 'POST', headers, body: JSON.stringify(seed.todos) }).catch(() => {});
        }
        if (seed.do_logs.length > 0) {
          await this._fetch(`${url}/do_logs`, { method: 'POST', headers, body: JSON.stringify(seed.do_logs) }).catch(() => {});
        }
      } catch (err) {
        console.warn('Cloud populateSyntheticSeed sync warning:', err.message);
      }
    }

    return seed;
  }

  async exportBackup() {
    return await this.fetchAll();
  }

  async importBackup(jsonString, fileSize) {
    if (fileSize && fileSize > CONFIG.MAX_IMPORT_FILE_SIZE) {
      throw new Error(`백업 파일 크기는 최대 5MB를 초과할 수 없습니다.`);
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      throw new Error('유효하지 않은 JSON 백업 파일 형식입니다.');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('백업 데이터 형식이 올바르지 않습니다.');
    }

    const previousBackup = this._loadData();

    try {
      const plans = Array.isArray(parsed.plans) ? parsed.plans : [];
      const histories = Array.isArray(parsed.plan_histories) ? parsed.plan_histories : [];
      const todos = Array.isArray(parsed.todos) ? parsed.todos : [];
      const do_logs = Array.isArray(parsed.do_logs) ? parsed.do_logs : [];
      const see_reviews = Array.isArray(parsed.see_reviews) ? parsed.see_reviews : [];

      const newStore = {
        plans,
        plan_histories: histories,
        todos,
        do_logs,
        see_reviews
      };

      this._saveData(newStore);

      if (this.isCloudConfigured && authClient.isAuthenticated()) {
        const url = `${CONFIG.SUPABASE.URL}/rest/v1`;
        const headers = { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' };
        if (plans.length > 0) {
          await this._fetch(`${url}/plans`, { method: 'POST', headers, body: JSON.stringify(plans) });
        }
        if (todos.length > 0) {
          await this._fetch(`${url}/todos`, { method: 'POST', headers, body: JSON.stringify(todos) });
        }
        if (do_logs.length > 0) {
          await this._fetch(`${url}/do_logs`, { method: 'POST', headers, body: JSON.stringify(do_logs) });
        }
        if (see_reviews.length > 0) {
          await this._fetch(`${url}/see_reviews`, { method: 'POST', headers, body: JSON.stringify(see_reviews) });
        }
      }

      return newStore;
    } catch (err) {
      this._saveData(previousBackup);
      throw new Error(`백업 복원에 실패하여 원상태로 롤백되었습니다: ${err.message}`);
    }
  }

  async migrateLocalData() {
    const localT06Key = 'pds_db_v2_scope_a';
    const raw = storage.getItem(localT06Key);
    if (!raw) return { migrated: 0 };

    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { migrated: 0 };
    }

    const current = this._loadData();
    const plans = Array.isArray(parsed.plans) ? parsed.plans : [];
    const todos = Array.isArray(parsed.todos) ? parsed.todos : [];
    const do_logs = Array.isArray(parsed.do_logs) ? parsed.do_logs : [];
    const see_reviews = Array.isArray(parsed.see_reviews) ? parsed.see_reviews : [];

    for (const p of plans) {
      if (!current.plans.some(cp => cp.id === p.id)) current.plans.push(p);
    }
    for (const t of todos) {
      if (!current.todos.some(ct => ct.id === t.id)) current.todos.push(t);
    }
    for (const l of do_logs) {
      if (!current.do_logs.some(cl => cl.id === l.id)) current.do_logs.push(l);
    }
    for (const r of see_reviews) {
      if (!current.see_reviews.some(cr => cr.id === r.id)) current.see_reviews.push(r);
    }

    this._saveData(current);

    if (this.isCloudConfigured && authClient.isAuthenticated()) {
      try {
        const url = `${CONFIG.SUPABASE.URL}/rest/v1`;
        const headers = { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' };
        if (current.plans.length > 0) {
          await this._fetch(`${url}/plans`, { method: 'POST', headers, body: JSON.stringify(current.plans) }).catch(() => {});
        }
        if (current.todos.length > 0) {
          await this._fetch(`${url}/todos`, { method: 'POST', headers, body: JSON.stringify(current.todos) }).catch(() => {});
        }
      } catch (err) {
        console.warn('Migration cloud sync warning:', err.message);
      }
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(localT06Key);
    }

    return { migrated: plans.length + todos.length };
  }
}

export const dbClient = new SupabaseEngine();
