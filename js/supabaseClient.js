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

// Safe localStorage abstraction
const storage = {
  getItem: (k) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null),
  setItem: (k, v) => (typeof localStorage !== 'undefined' ? localStorage.setItem(k, v) : null)
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
        if (Array.isArray(parsed.do_logs)) {
          const logMap = new Map();
          for (const l of parsed.do_logs) {
            logMap.set(String(l.todo_id), l);
          }
          parsed.do_logs = Array.from(logMap.values());
        }
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
    
    // Deduplicate do_logs strictly by todo_id to prevent double counting
    const logsByTodo = new Map();
    for (const l of (local.do_logs || [])) {
      logsByTodo.set(String(l.todo_id), l);
    }
    for (const l of (cloud.do_logs || [])) {
      const existing = logsByTodo.get(String(l.todo_id));
      if (!existing || new Date(l.updated_at || l.created_at || 0) >= new Date(existing.updated_at || existing.created_at || 0)) {
        logsByTodo.set(String(l.todo_id), l);
      }
    }

    const reviewsMap = new Map((local.see_reviews || []).map(r => [r.id, r]));
    for (const r of (cloud.see_reviews || [])) {
      reviewsMap.set(r.id, r);
    }

    const merged = {
      
      plans: Array.from(plansMap.values()),
      plan_histories: Array.from(historiesMap.values()),
      todos: Array.from(todosMap.values()),
      do_logs: Array.from(logsByTodo.values()),
      see_reviews: Array.from(reviewsMap.values())
    };
    this._saveData(merged);
    return merged;
  }

  

  // --- QUERY & MUTATION INTERFACES (RLS & E2EE Automatic Encryption) ---

  async _fetch(url, options = {}, retries = 1) {
    let res = await fetch(url, options);
    if (!res.ok && res.status === 401 && retries > 0) {
      let data = {};
      try { data = await res.clone().json(); } catch(e) {}
      if (JSON.stringify(data).includes('JWT issued at future') || JSON.stringify(data).includes('PGRST303')) {
        await new Promise(r => setTimeout(r, 1500));
        return this._fetch(url, options, 0);
      }
    }
    return res;
  }

  async fetchAll() {
    

    let rawData;

    if (this.isCloudConfigured) {
      try {
        const url = `${CONFIG.SUPABASE.URL}/rest/v1`;
        const headers = this._getCloudHeaders();
        const [plansRes, historiesRes, todosRes, doLogsRes, seeRes] = await Promise.all([
          this._fetch(`${url}/plans?select=*&order=created_at.desc`, { headers }),
          this._fetch(`${url}/plan_histories?select=*&order=revision_number.desc`, { headers }),
          this._fetch(`${url}/todos?select=*&order=sort_order.asc`, { headers }),
          this._fetch(`${url}/do_logs?select=*`, { headers }),
          this._fetch(`${url}/see_reviews?select=*&order=created_at.desc`, { headers })
        ]);

        if (plansRes.ok && todosRes.ok) {
          const cloudData = {
            plans: await plansRes.json(),
            plan_histories: await historiesRes.json(),
            todos: await todosRes.json(),
            do_logs: await doLogsRes.json(),
            see_reviews: await seeRes.json()
          };
          this._saveData(cloudData);
          rawData = cloudData;
        } else {
          rawData = JSON.parse(JSON.stringify(this._loadData()));
        }
      } catch (err) {
        console.warn('Supabase cloud fetch failed, falling back to local database engine:', err.message);
        rawData = JSON.parse(JSON.stringify(this._loadData()));
      }
    } else {
      rawData = JSON.parse(JSON.stringify(this._loadData()));
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
      blocked_reason: await decryptText(l.blocked_reason),
        memo: await decryptText(l.memo)
    })));

    const decryptedSeeReviews = await Promise.all(rawData.see_reviews.map(async (r) => ({
      ...r,
      adjustment_insight: await decryptText(r.adjustment_insight)
    })));

    return {
     
      plans: decryptedPlans,
      plan_histories: decryptedHistories,
      todos: decryptedTodos,
      do_logs: decryptedDoLogs,
      see_reviews: decryptedSeeReviews
    };
  }

  async createPlan(planData) {
    
    const cleanTitle = sanitizeText(planData.title, 255);
    const cleanCriteria = sanitizeText(planData.success_criteria);
    const cleanHours = clampNum(planData.estimated_hours);
    if (cleanHours <= 0) {
      throw new Error('목표 예상 시간은 최소 1분 이상이어야 합니다.');
    }

    const signature = `plan|${cleanTitle}|${planData.period_start}|${planData.period_end}|${cleanHours}`;
    const now = Date.now();
    const lastTime = this.inFlightLocks.get(signature);
    if (lastTime && (now - lastTime) < 1500) {
      if (!this.isCloudConfigured) {
        const data = this._loadData();
        const existing = data.plans.find(p => p.title === cleanTitle && p.period_start === planData.period_start && p.period_end === planData.period_end);
        if (existing) return existing;
      }
    }
    this.inFlightLocks.set(signature, now);

    const encryptedCriteria = await encryptText(cleanCriteria);

    const payload = {
      ...planData,
      title: cleanTitle,
      estimated_hours: cleanHours,
      success_criteria: encryptedCriteria
    };

    const data = this._loadData();
    const newPlan = {
      id: crypto.randomUUID(),
      ...payload,
      
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (this.isCloudConfigured) {
      try {
        const res = await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans`, {
          method: 'POST',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({ ...payload, id: newPlan.id })
        });
        if (res.ok) {
          const created = await res.json();
          if (created && created[0]) {
            newPlan.id = created[0].id;
          }
        }
      } catch (err) {
        console.warn('Cloud createPlan sync warning:', err.message);
      }
    }

    data.plans.unshift(newPlan);
    this._saveData(data);
    return { ...newPlan, success_criteria: cleanCriteria };
  }

  async updatePlan(planId, updates) {
    
    const cleanTitle = updates.title !== undefined ? sanitizeText(updates.title, 255) : undefined;
    const cleanCriteria = updates.success_criteria !== undefined ? sanitizeText(updates.success_criteria) : undefined;
    const cleanHours = updates.estimated_hours !== undefined ? clampNum(updates.estimated_hours) : undefined;
    if (cleanHours !== undefined && cleanHours <= 0) {
      throw new Error('목표 예상 시간은 최소 1분 이상이어야 합니다.');
    }
    const encryptedCriteria = cleanCriteria !== undefined ? await encryptText(cleanCriteria) : undefined;

    const payload = {
      ...(cleanTitle !== undefined ? { title: cleanTitle } : {}),
      ...(updates.period_start !== undefined ? { period_start: updates.period_start } : {}),
      ...(updates.period_end !== undefined ? { period_end: updates.period_end } : {}),
      ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
      ...(cleanHours !== undefined ? { estimated_hours: cleanHours } : {}),
      ...(encryptedCriteria !== undefined ? { success_criteria: encryptedCriteria } : {}),
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      updated_at: new Date().toISOString()
    };

    const data = this._loadData();
    const index = data.plans.findIndex(p => String(p.id) === String(planId) );
    if (index === -1) {
      throw new Error('계획을 찾을 수 없거나 접근이 거부되었습니다. (PostgreSQL RLS 404)');
    }

    if (updates.estimated_hours !== undefined) {
      const newPlanMin = parseInt(updates.estimated_hours, 10) || 0;
      const childTodos = data.todos.filter(t => String(t.plan_id) === String(planId));
      const totalTodoMin = childTodos.reduce((sum, t) => sum + (parseInt(t.estimated_minutes, 10) || 0), 0);
      if (totalTodoMin > 0 && newPlanMin < totalTodoMin) {
        throw new Error(`계획 목표 시간(${newPlanMin}분)은 등록된 할 일들의 예상 시간 합계(${totalTodoMin}분)보다 작을 수 없습니다.`);
      }
    }

    if (this.isCloudConfigured) {
      try {
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans?id=eq.${planId}`, {
          method: 'PATCH',
          headers: this._getCloudHeaders(),
          body: JSON.stringify(payload)
        });
      } catch (err) {
        console.warn('Cloud updatePlan sync warning:', err.message);
      }
    }

    const oldPlan = data.plans[index];
    const revCount = data.plan_histories.filter(h => h.plan_id === planId).length;
    data.plan_histories.unshift({
      id: crypto.randomUUID(),
      plan_id: oldPlan.id,
      
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
      
      updated_at: new Date().toISOString()
    };
    delete updated.revision_reason;
    data.plans[index] = updated;
    this._saveData(data);
    return { ...updated, success_criteria: cleanCriteria !== undefined ? cleanCriteria : oldPlan.success_criteria };
  }

  async deletePlan(planId) {
    

    const data = this._loadData();
    const planIndex = data.plans.findIndex(p => p.id === planId );
    if (planIndex === -1) {
      const err = new Error('계획을 찾을 수 없거나 삭제 권한이 없습니다. (PostgreSQL RLS 404/403)');
      err.status = 403;
      throw err;
    }

    if (this.isCloudConfigured) {
      try {
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans?id=eq.${planId}`, {
          method: 'DELETE',
          headers: this._getCloudHeaders()
        });
      } catch (err) {
        console.warn('Cloud deletePlan sync warning:', err.message);
      }
    }

    const childTodoIds = new Set(data.todos.filter(t => t.plan_id === planId).map(t => t.id));
    data.plans.splice(planIndex, 1);
    data.plan_histories = data.plan_histories.filter(h => h.plan_id !== planId);
    data.todos = data.todos.filter(t => t.plan_id !== planId);
    data.do_logs = data.do_logs.filter(l => !childTodoIds.has(l.todo_id));
    data.see_reviews = data.see_reviews.filter(r => r.plan_id !== planId);
    this._saveData(data);
    return { success: true };
  }

  async createTodo(todoData) {
    
    const cleanTitle = sanitizeText(todoData.title, 255);
    const cleanDesc = sanitizeText(todoData.description);
    const cleanMin = clampNum(todoData.estimated_minutes);
    if (cleanMin <= 0) {
      throw new Error('할 일 예상 소요 시간은 최소 1분 이상이어야 합니다.');
    }

    const signature = `todo|${todoData.plan_id}|${cleanTitle}|${todoData.due_date}|${cleanMin}`;
    const now = Date.now();
    const lastTime = this.inFlightLocks.get(signature);
    if (lastTime && (now - lastTime) < 1500) {
      if (!this.isCloudConfigured) {
        const data = this._loadData();
        const existing = data.todos.find(t => t.plan_id === todoData.plan_id && t.title === cleanTitle && t.due_date === todoData.due_date);
        if (existing) return existing;
      }
    }
    this.inFlightLocks.set(signature, now);

    const cleanTags = (Array.isArray(todoData.tags) ? todoData.tags : []).map(t => sanitizeText(t, 50)).filter(Boolean);
    const encryptedDesc = await encryptText(cleanDesc);

    const payload = {
      ...todoData,
      title: cleanTitle,
      description: encryptedDesc,
      estimated_minutes: cleanMin,
      tags: cleanTags
    };

    const data = this._loadData();
    const targetPlan = data.plans.find(p => String(p.id) === String(todoData.plan_id));
    if (targetPlan) {
      if (targetPlan.period_end && (todoData.due_date > targetPlan.period_end || todoData.due_date < targetPlan.period_start)) {
        throw new Error(`할 일 마감일(${todoData.due_date})은 연결된 계획의 종료일(${targetPlan.period_end})을 초과할 수 없습니다.`);
      }
      if (targetPlan.estimated_hours !== undefined) {
        const planBudgetMinutes = parseInt(targetPlan.estimated_hours, 10) || 0;
        const newTodoMinutes = parseInt(cleanMin, 10) || 0;
        const otherTodos = data.todos.filter(t => String(t.plan_id) === String(todoData.plan_id));
        const currentTotalMin = otherTodos.reduce((sum, t) => sum + (parseInt(t.estimated_minutes, 10) || 0), 0);
        const newTotalMin = currentTotalMin + newTodoMinutes;
        if (planBudgetMinutes > 0 && newTotalMin > planBudgetMinutes) {
          throw new Error(`할 일들의 예상 시간 합계(${newTotalMin}분)가 계획의 목표 시간(${planBudgetMinutes}분)을 초과할 수 없습니다.`);
        }
      }
    }

    const newTodo = {
      id: crypto.randomUUID(),
      ...payload,
      
      is_completed: false,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (this.isCloudConfigured) {
      try {
        const res = await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos`, {
          method: 'POST',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({ ...payload, id: newTodo.id, is_completed: false })
        });
        if (res.ok) {
          const created = await res.json();
          if (created && created[0]) {
            newTodo.id = created[0].id;
          }
        }
      } catch (err) {
        console.warn('Cloud createTodo sync warning:', err.message);
      }
    }

    data.todos.push(newTodo);
    this._saveData(data);
    return { ...newTodo, description: cleanDesc };
  }

  async updateTodo(todoId, updates) {
    
    const cleanTitle = updates.title !== undefined ? sanitizeText(updates.title, 255) : undefined;
    const cleanDesc = updates.description !== undefined ? sanitizeText(updates.description) : undefined;
    const cleanMin = updates.estimated_minutes !== undefined ? clampNum(updates.estimated_minutes) : undefined;
    if (cleanMin !== undefined && cleanMin <= 0) {
      throw new Error('할 일 예상 소요 시간은 최소 1분 이상이어야 합니다.');
    }
    const cleanTags = updates.tags !== undefined ? (Array.isArray(updates.tags) ? updates.tags : []).map(t => sanitizeText(t, 50)).filter(Boolean) : undefined;
    const encryptedDesc = cleanDesc !== undefined ? await encryptText(cleanDesc) : undefined;

    const payload = {
      ...updates,
      ...(cleanTitle !== undefined ? { title: cleanTitle } : {}),
      ...(cleanMin !== undefined ? { estimated_minutes: cleanMin } : {}),
      ...(cleanTags !== undefined ? { tags: cleanTags } : {}),
      ...(encryptedDesc !== undefined ? { description: encryptedDesc } : {})
    };

    const data = this._loadData();
    const index = data.todos.findIndex(t => String(t.id) === String(todoId) );
    if (index === -1) {
      throw new Error('할 일을 찾을 수 없거나 접근이 거부되었습니다. (PostgreSQL RLS 404)');
    }
    const currentTodo = data.todos[index];
    const planId = updates.plan_id || currentTodo.plan_id;
    const targetPlan = data.plans.find(p => String(p.id) === String(planId));

    if (targetPlan && targetPlan.estimated_hours !== undefined) {
      const planBudgetMinutes = parseInt(targetPlan.estimated_hours, 10) || 0;
      const newMinutes = updates.estimated_minutes !== undefined ? (parseInt(cleanMin, 10) || 0) : (parseInt(currentTodo.estimated_minutes, 10) || 0);
      const otherTodos = data.todos.filter(t => String(t.plan_id) === String(planId) && String(t.id) !== String(todoId));
      const currentTotalMin = otherTodos.reduce((sum, t) => sum + (parseInt(t.estimated_minutes, 10) || 0), 0);
      const newTotalMin = currentTotalMin + newMinutes;
      if (planBudgetMinutes > 0 && newTotalMin > planBudgetMinutes) {
        throw new Error(`할 일들의 예상 시간 합계(${newTotalMin}분)가 계획의 목표 시간(${planBudgetMinutes}분)을 초과할 수 없습니다.`);
      }
    }

    if (this.isCloudConfigured) {
      try {
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos?id=eq.${todoId}`, {
          method: 'PATCH',
          headers: this._getCloudHeaders(),
          body: JSON.stringify(payload)
        });
      } catch (err) {
        console.warn('Cloud updateTodo sync warning:', err.message);
      }
    }

    const updated = {
      ...data.todos[index],
      ...payload,
      
      updated_at: new Date().toISOString()
    };
    data.todos[index] = updated;
    this._saveData(data);
    return { ...updated, description: cleanDesc !== undefined ? cleanDesc : data.todos[index].description };
  }

  async deleteTodo(todoId) {
    

    const data = this._loadData();
    const todoIndex = data.todos.findIndex(t => t.id === todoId );
    if (todoIndex === -1) {
      const err = new Error('할 일을 찾을 수 없거나 삭제 권한이 없습니다. (PostgreSQL RLS 404/403)');
      err.status = 403;
      throw err;
    }

    if (this.isCloudConfigured) {
      try {
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos?id=eq.${todoId}`, {
          method: 'DELETE',
          headers: this._getCloudHeaders()
        });
      } catch (err) {
        console.warn('Cloud deleteTodo sync warning:', err.message);
      }
    }

    data.todos.splice(todoIndex, 1);
    data.do_logs = data.do_logs.filter(l => l.todo_id !== todoId);
    this._saveData(data);
    return { success: true };
    return { success: true };
  }

  async completeTodoIdempotent(todoId, logData, completionToken) {
    
    const cleanBlocker = sanitizeText(logData.blocked_reason);
    const cleanMin = clampNum(logData.actual_minutes);
    if (cleanMin <= 0) {
      throw new Error('실제 소요 시간은 최소 1분 이상이어야 합니다.');
    }
    const encryptedBlocker = await encryptText(cleanBlocker);

    const data = this._loadData();
    const todo = data.todos.find(t => String(t.id) === String(todoId) );
    if (!todo) {
      throw new Error('할 일을 찾을 수 없습니다. (PostgreSQL RLS 404)');
    }

    const isDuplicateToken = data.do_logs.some(l => l.todo_id === todoId && l.completion_token === completionToken);
    const otherLogs = data.do_logs.filter(l => String(l.todo_id) !== String(todoId));
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

    otherLogs.push(newLog);
    data.do_logs = otherLogs;

    todo.is_completed = true;
    todo.completed_at = todo.completed_at || new Date().toISOString();
    todo.updated_at = new Date().toISOString();
    this._saveData(data);

    if (this.isCloudConfigured) {
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

        // Direct update and log insert
        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos?id=eq.${todoId}`, {
          method: 'PATCH',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({ is_completed: true, completed_at: todo.completed_at, updated_at: todo.updated_at })
        }).catch(() => {});

        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs?todo_id=eq.${todoId}`, {
          method: 'DELETE',
          headers: this._getCloudHeaders()
        }).catch(() => {});

        if (!isDuplicateToken) {
          await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs`, {
            method: 'POST',
            headers: this._getCloudHeaders(),
            body: JSON.stringify({
              id: newLog.id,
              todo_id: todoId,
             
              execution_start: newLog.execution_start,
              execution_end: newLog.execution_end,
              actual_minutes: cleanMin,
              blocked_reason: encryptedBlocker,
              completion_token: completionToken
            })
          }).catch(() => {});
        }
      } catch (err) {
        console.warn('Cloud completeTodoIdempotent sync warning:', err.message);
      }
    }

    return { success: true, todo, isDuplicate: isDuplicateToken };
  }

  async addDoLog(todoId, logData) {
    
    const cleanBlocker = sanitizeText(logData.blocked_reason);
    const cleanMin = clampNum(logData.actual_minutes);
    if (cleanMin <= 0) {
      throw new Error('실제 소요 시간은 최소 1분 이상이어야 합니다.');
    }
    const encryptedBlocker = await encryptText(cleanBlocker);

    const data = this._loadData();
    const todo = data.todos.find(t => String(t.id) === String(todoId) );

    // Strictly replace ANY existing logs for this todo with the single authoritative log
    const otherLogs = data.do_logs.filter(l => String(l.todo_id) !== String(todoId));
    const newLog = {
      id: crypto.randomUUID(),
      todo_id: todoId,
      
      execution_start: logData.execution_start || new Date().toISOString(),
      execution_end: logData.execution_end || new Date().toISOString(),
      actual_minutes: cleanMin,
      blocked_reason: encryptedBlocker,
        memo: encryptedMemo,
        completion_token: logData.completion_token || crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    otherLogs.push(newLog);
    data.do_logs = otherLogs;
    this._saveData(data);

    if (this.isCloudConfigured) {
      try {
        if (todo) {
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
        }

        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs?todo_id=eq.${todoId}`, {
          method: 'DELETE',
          headers: this._getCloudHeaders()
        }).catch(() => {});

        await this._fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs`, {
          method: 'POST',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({
            id: newLog.id,
            todo_id: todoId,
           
            execution_start: newLog.execution_start,
            execution_end: newLog.execution_end,
            actual_minutes: cleanMin,
            blocked_reason: encryptedBlocker,
            completion_token: newLog.completion_token
          })
        });
      } catch (err) {
        console.warn('Cloud addDoLog sync warning:', err.message);
      }
    }

    return { ...newLog, blocked_reason: cleanBlocker };
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
    const targetPlan = data.plans.find(p => String(p.id) === String(reviewData.plan_id) );
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

    if (this.isCloudConfigured) {
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

    if (this.isCloudConfigured) {
      try {
        const url = `${CONFIG.SUPABASE.URL}/rest/v1`;
        const headers = this._getCloudHeaders();
        await Promise.all([
          this._fetch(`${url}/see_reviews`, { method: 'DELETE', headers }),
          this._fetch(`${url}/do_logs`, { method: 'DELETE', headers }),
          this._fetch(`${url}/todos`, { method: 'DELETE', headers }),
          this._fetch(`${url}/plan_histories`, { method: 'DELETE', headers }),
          this._fetch(`${url}/plans`, { method: 'DELETE', headers })
        ]);
      } catch (err) {
        console.warn('Cloud data purge sync warning:', err.message);
      }
    }

    return { success: true };
  }

  async populateSyntheticSeed() {
    const seed = this._createSeedData();
    this._saveData(seed);

    if (this.isCloudConfigured) {
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

    return { success: true };
  }

  async restoreBackup(validatedPayload) {
    
    const existing = this._loadData();

    // Encrypt sensitive fields for safe at-rest storage
    const encryptedPlans = await Promise.all((validatedPayload.plans || []).map(async p => ({
      ...p,
     
      success_criteria: p.success_criteria ? await encryptText(p.success_criteria) : ''
    })));
    const encryptedHistories = await Promise.all((validatedPayload.plan_histories || []).map(async h => ({
      ...h,
     
      success_criteria: h.success_criteria ? await encryptText(h.success_criteria) : ''
    })));
    const encryptedTodos = await Promise.all((validatedPayload.todos || []).map(async t => ({
      ...t,
     
      description: t.description ? await encryptText(t.description) : ''
    })));
    const encryptedLogs = await Promise.all((validatedPayload.do_logs || []).map(async l => ({
      ...l,
     
      blocked_reason: l.blocked_reason ? await encryptText(l.blocked_reason) : ''
    })));
    const encryptedReviews = await Promise.all((validatedPayload.see_reviews || []).map(async r => ({
      ...r,
     
      adjustment_insight: r.adjustment_insight ? await encryptText(r.adjustment_insight) : ''
    })));

    const planMap = new Map(existing.plans.map(p => [p.id, p]));
    for (const p of encryptedPlans) {
      planMap.set(p.id, p);
    }

    const historyMap = new Map(existing.plan_histories.map(h => [h.id, h]));
    for (const h of encryptedHistories) {
      historyMap.set(h.id, h);
    }

    const todoMap = new Map(existing.todos.map(t => [t.id, t]));
    for (const t of encryptedTodos) {
      todoMap.set(t.id, t);
    }

    // Deduplicate do_logs by todo_id
    const logMap = new Map(existing.do_logs.map(l => [String(l.todo_id), l]));
    for (const l of encryptedLogs) {
      logMap.set(String(l.todo_id), l);
    }

    const reviewMap = new Map(existing.see_reviews.map(r => [r.id, r]));
    for (const r of encryptedReviews) {
      reviewMap.set(r.id, r);
    }

    const merged = {
     
      plans: Array.from(planMap.values()),
      plan_histories: Array.from(historyMap.values()),
      todos: Array.from(todoMap.values()),
      do_logs: Array.from(logMap.values()),
      see_reviews: Array.from(reviewMap.values())
    };

    this._saveData(merged);

    if (this.isCloudConfigured) {
      try {
        const url = `${CONFIG.SUPABASE.URL}/rest/v1`;
        const headers = { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' };
        if (merged.plans.length > 0) {
          await this._fetch(`${url}/plans`, { method: 'POST', headers, body: JSON.stringify(merged.plans) }).catch(() => {});
        }
        if (merged.plan_histories.length > 0) {
          await this._fetch(`${url}/plan_histories`, { method: 'POST', headers, body: JSON.stringify(merged.plan_histories) }).catch(() => {});
        }
        if (merged.todos.length > 0) {
          await this._fetch(`${url}/todos`, { method: 'POST', headers, body: JSON.stringify(merged.todos) }).catch(() => {});
        }
        if (merged.do_logs.length > 0) {
          await this._fetch(`${url}/do_logs`, { method: 'POST', headers, body: JSON.stringify(merged.do_logs) }).catch(() => {});
        }
        if (merged.see_reviews.length > 0) {
          await this._fetch(`${url}/see_reviews`, { method: 'POST', headers, body: JSON.stringify(merged.see_reviews) }).catch(() => {});
        }
      } catch (err) {
        console.warn('Cloud restoreBackup sync warning:', err.message);
      }
    }

    return { success: true, count: merged.plans.length };
  }
}

export const dbClient = new SupabaseEngine();
