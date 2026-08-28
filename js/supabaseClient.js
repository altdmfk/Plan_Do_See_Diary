/**
 * Plan-Do-See Diary - Database Client & Scope Isolation Layer
 * Connects to Supabase PostgREST API with Row-Level Security (RLS) policies
 * and provides high-fidelity local PostgreSQL engine with automatic at-rest encryption and bounds sanitization.
 */

import { CONFIG } from './config.js';
import { getKSTToday } from './dateUtils.js';
import { encryptText, decryptText } from './crypto.js';
import { sanitizeText, clampNum } from './validators.js';

// Safe localStorage abstraction
const storage = {
  getItem: (k) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null),
  setItem: (k, v) => (typeof localStorage !== 'undefined' ? localStorage.setItem(k, v) : null)
};

class SupabaseScopeEngine {
  constructor() {
    this.currentScope = storage.getItem(CONFIG.STORAGE_KEYS.ACTIVE_SCOPE) || CONFIG.DEFAULT_SCOPE;
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
        if (Array.isArray(parsed.do_logs)) {
          const logMap = new Map();
          for (const l of parsed.do_logs) {
            logMap.set(String(l.todo_id), l);
          }
          parsed.do_logs = Array.from(logMap.values());
        }
        this.memoryStore.set(scope, parsed);
        return parsed;
      } catch (e) {
        console.error('Failed to parse scope store', e);
      }
    }
    const fresh = CONFIG.ENABLE_SYNTHETIC_SEED !== false
      ? this._createSeedData(scope)
      : { scope, plans: [], plan_histories: [], todos: [], do_logs: [], see_reviews: [] };
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
          title: isScopeA ? '이번 주 건강 관리 및 운동 루틴 실천' : '독서 및 어학 자기계발 습관 만들기',
          period_start: today,
          period_end: today,
          priority: isScopeA ? 'urgent' : 'high',
          success_criteria: isScopeA 
            ? '주 4회 운동 완료 및 매일 물 2L 마시기 100% 실천' 
            : '책 1권 완독 및 하루 20분 영어 팟캐스트 청취',
          estimated_hours: isScopeA ? 360 : 480,
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
          title: isScopeA ? '아침 공복 스트레칭 및 영양제 챙겨먹기' : '출퇴근길에 영어 회화 팟캐스트 1에피소드 듣기',
          description: isScopeA ? '기상 직후 전신 스트레칭 10분 진행 및 비타민 복용' : '출근길 지하철에서 핵심 표현 3개 메모하기',
          due_date: today,
          priority: 'urgent',
          tags: isScopeA ? ['건강', '루틴'] : ['영어', '어학'],
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
          scope: scope,
          title: isScopeA ? '퇴근 후 헬스장에서 런닝머신 40분 뛰기' : '자기 전 침대에서 책 30페이지 읽기',
          description: isScopeA ? '가벼운 조깅 속도로 심폐 지구력 기르기' : '스마트폰 내려놓고 조용한 환경에서 독서하기',
          due_date: today,
          priority: 'high',
          tags: isScopeA ? ['운동', '헬스'] : ['독서', '자기계발'],
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
          scope: scope,
          title: isScopeA ? '주말 식단용 신선한 샐러드 및 과일 장보기' : '이번 주 읽은 책의 인상 깊은 문장 독서 노트에 기록',
          description: isScopeA ? '주말 동안 먹을 건강한 식재료 구매하기' : '좋았던 구절과 느낀 점 3줄 요약',
          due_date: today,
          priority: 'medium',
          tags: isScopeA ? ['식단', '건강'] : ['독서', '기록'],
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

  _mergeScopeData(local, cloud) {
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
      scope: local.scope || cloud.scope,
      plans: Array.from(plansMap.values()),
      plan_histories: Array.from(historiesMap.values()),
      todos: Array.from(todosMap.values()),
      do_logs: Array.from(logsByTodo.values()),
      see_reviews: Array.from(reviewsMap.values())
    };
    this._saveScopeData(merged.scope, merged);
    return merged;
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
      try {
        const url = `${CONFIG.SUPABASE.URL}/rest/v1`;
        const headers = this._getCloudHeaders();
        const [plansRes, historiesRes, todosRes, doLogsRes, seeRes] = await Promise.all([
          fetch(`${url}/plans?scope=eq.${scope}&select=*&order=created_at.desc`, { headers }),
          fetch(`${url}/plan_histories?scope=eq.${scope}&select=*&order=revision_number.desc`, { headers }),
          fetch(`${url}/todos?scope=eq.${scope}&select=*&order=sort_order.asc`, { headers }),
          fetch(`${url}/do_logs?scope=eq.${scope}&select=*`, { headers }),
          fetch(`${url}/see_reviews?scope=eq.${scope}&select=*&order=created_at.desc`, { headers })
        ]);

        if (plansRes.ok && todosRes.ok) {
          const localData = this._loadScopeData(scope);
          if (localData && Array.isArray(localData.plans) && localData.plans.length === 0 && Array.isArray(localData.todos) && localData.todos.length === 0) {
            // Explicitly purged state: return 0 items
            rawData = JSON.parse(JSON.stringify(localData));
          } else {
            const cloudData = {
              scope,
              plans: await plansRes.json(),
              plan_histories: await historiesRes.json(),
              todos: await todosRes.json(),
              do_logs: await doLogsRes.json(),
              see_reviews: await seeRes.json()
            };
            rawData = this._mergeScopeData(localData, cloudData);
          }
        } else {
          rawData = JSON.parse(JSON.stringify(this._loadScopeData(scope)));
        }
      } catch (err) {
        console.warn('Supabase cloud fetch failed, falling back to local database engine:', err.message);
        rawData = JSON.parse(JSON.stringify(this._loadScopeData(scope)));
      }
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
    if (cleanHours <= 0) {
      throw new Error('목표 예상 시간은 최소 1분 이상이어야 합니다.');
    }

    const signature = `${scope}|plan|${cleanTitle}|${planData.period_start}|${planData.period_end}|${cleanHours}`;
    const now = Date.now();
    const lastTime = this.inFlightLocks.get(signature);
    if (lastTime && (now - lastTime) < 1500) {
      if (!this.isCloudConfigured) {
        const data = this._loadScopeData(scope);
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

    const data = this._loadScopeData(scope);
    const newPlan = {
      id: crypto.randomUUID(),
      ...payload,
      scope: scope,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (this.isCloudConfigured) {
      try {
        const res = await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans`, {
          method: 'POST',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({ ...payload, id: newPlan.id, scope })
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
    this._saveScopeData(scope, data);
    return { ...newPlan, success_criteria: cleanCriteria };
  }

  async updatePlan(planId, updates) {
    const scope = this.currentScope;
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

    const data = this._loadScopeData(scope);
    const index = data.plans.findIndex(p => String(p.id) === String(planId) && p.scope === scope);
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
        await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans?id=eq.${planId}&scope=eq.${scope}`, {
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

    const data = this._loadScopeData(scope);
    const planIndex = data.plans.findIndex(p => p.id === planId && p.scope === scope);
    if (planIndex === -1) {
      const err = new Error('계획을 찾을 수 없거나 삭제 권한이 없습니다. (PostgreSQL RLS 404/403)');
      err.status = 403;
      throw err;
    }

    if (this.isCloudConfigured) {
      try {
        await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans?id=eq.${planId}&scope=eq.${scope}`, {
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
    this._saveScopeData(scope, data);
    return { success: true };
  }

  async createTodo(todoData) {
    const scope = this.currentScope;
    const cleanTitle = sanitizeText(todoData.title, 255);
    const cleanDesc = sanitizeText(todoData.description);
    const cleanMin = clampNum(todoData.estimated_minutes);
    if (cleanMin <= 0) {
      throw new Error('할 일 예상 소요 시간은 최소 1분 이상이어야 합니다.');
    }

    const signature = `${scope}|todo|${todoData.plan_id}|${cleanTitle}|${todoData.due_date}|${cleanMin}`;
    const now = Date.now();
    const lastTime = this.inFlightLocks.get(signature);
    if (lastTime && (now - lastTime) < 1500) {
      if (!this.isCloudConfigured) {
        const data = this._loadScopeData(scope);
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

    const data = this._loadScopeData(scope);
    const targetPlan = data.plans.find(p => String(p.id) === String(todoData.plan_id));
    if (targetPlan) {
      if (targetPlan.period_end && todoData.due_date > targetPlan.period_end) {
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
      scope: scope,
      is_completed: false,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (this.isCloudConfigured) {
      try {
        const res = await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos`, {
          method: 'POST',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({ ...payload, id: newTodo.id, scope, is_completed: false })
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
    this._saveScopeData(scope, data);
    return { ...newTodo, description: cleanDesc };
  }

  async updateTodo(todoId, updates) {
    const scope = this.currentScope;
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

    const data = this._loadScopeData(scope);
    const index = data.todos.findIndex(t => String(t.id) === String(todoId) && t.scope === scope);
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
        await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos?id=eq.${todoId}&scope=eq.${scope}`, {
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
      scope: scope,
      updated_at: new Date().toISOString()
    };
    data.todos[index] = updated;
    this._saveScopeData(scope, data);
    return { ...updated, description: cleanDesc !== undefined ? cleanDesc : data.todos[index].description };
  }

  async deleteTodo(todoId) {
    const scope = this.currentScope;

    const data = this._loadScopeData(scope);
    const todoIndex = data.todos.findIndex(t => t.id === todoId && t.scope === scope);
    if (todoIndex === -1) {
      const err = new Error('할 일을 찾을 수 없거나 삭제 권한이 없습니다. (PostgreSQL RLS 404/403)');
      err.status = 403;
      throw err;
    }

    if (this.isCloudConfigured) {
      try {
        await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos?id=eq.${todoId}&scope=eq.${scope}`, {
          method: 'DELETE',
          headers: this._getCloudHeaders()
        });
      } catch (err) {
        console.warn('Cloud deleteTodo sync warning:', err.message);
      }
    }

    data.todos.splice(todoIndex, 1);
    data.do_logs = data.do_logs.filter(l => l.todo_id !== todoId);
    this._saveScopeData(scope, data);
    return { success: true };
    return { success: true };
  }

  async completeTodoIdempotent(todoId, logData, completionToken) {
    const scope = this.currentScope;
    const cleanBlocker = sanitizeText(logData.blocked_reason);
    const cleanMin = clampNum(logData.actual_minutes);
    if (cleanMin <= 0) {
      throw new Error('실제 소요 시간은 최소 1분 이상이어야 합니다.');
    }
    const encryptedBlocker = await encryptText(cleanBlocker);

    const data = this._loadScopeData(scope);
    const todo = data.todos.find(t => String(t.id) === String(todoId) && t.scope === scope);
    if (!todo) {
      throw new Error('할 일을 찾을 수 없습니다. (PostgreSQL RLS 404)');
    }

    const isDuplicateToken = data.do_logs.some(l => l.todo_id === todoId && l.completion_token === completionToken);
    const otherLogs = data.do_logs.filter(l => String(l.todo_id) !== String(todoId));
    const newLog = {
      id: crypto.randomUUID(),
      todo_id: todoId,
      scope: scope,
      execution_start: logData.execution_start || new Date().toISOString(),
      execution_end: logData.execution_end || new Date().toISOString(),
      actual_minutes: cleanMin,
      blocked_reason: encryptedBlocker,
      completion_token: completionToken,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    otherLogs.push(newLog);
    data.do_logs = otherLogs;

    todo.is_completed = true;
    todo.completed_at = todo.completed_at || new Date().toISOString();
    todo.updated_at = new Date().toISOString();
    this._saveScopeData(scope, data);

    if (this.isCloudConfigured) {
      try {
        const parentPlan = data.plans.find(p => String(p.id) === String(todo.plan_id));
        if (parentPlan) {
          await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans`, {
            method: 'POST',
            headers: { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({ ...parentPlan, scope })
          }).catch(() => {});
        }
        await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos`, {
          method: 'POST',
          headers: { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ ...todo, scope })
        }).catch(() => {});

        // Direct update and log insert
        await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos?id=eq.${todoId}&scope=eq.${scope}`, {
          method: 'PATCH',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({ is_completed: true, completed_at: todo.completed_at, updated_at: todo.updated_at })
        }).catch(() => {});

        await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs?todo_id=eq.${todoId}&scope=eq.${scope}`, {
          method: 'DELETE',
          headers: this._getCloudHeaders()
        }).catch(() => {});

        if (!isDuplicateToken) {
          await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs`, {
            method: 'POST',
            headers: this._getCloudHeaders(),
            body: JSON.stringify({
              id: newLog.id,
              todo_id: todoId,
              scope,
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
    const scope = this.currentScope;
    const cleanBlocker = sanitizeText(logData.blocked_reason);
    const cleanMin = clampNum(logData.actual_minutes);
    if (cleanMin <= 0) {
      throw new Error('실제 소요 시간은 최소 1분 이상이어야 합니다.');
    }
    const encryptedBlocker = await encryptText(cleanBlocker);

    const data = this._loadScopeData(scope);
    const todo = data.todos.find(t => String(t.id) === String(todoId) && t.scope === scope);

    // Strictly replace ANY existing logs for this todo with the single authoritative log
    const otherLogs = data.do_logs.filter(l => String(l.todo_id) !== String(todoId));
    const newLog = {
      id: crypto.randomUUID(),
      todo_id: todoId,
      scope: scope,
      execution_start: logData.execution_start || new Date().toISOString(),
      execution_end: logData.execution_end || new Date().toISOString(),
      actual_minutes: cleanMin,
      blocked_reason: encryptedBlocker,
      completion_token: logData.completion_token || crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    otherLogs.push(newLog);
    data.do_logs = otherLogs;
    this._saveScopeData(scope, data);

    if (this.isCloudConfigured) {
      try {
        if (todo) {
          const parentPlan = data.plans.find(p => String(p.id) === String(todo.plan_id));
          if (parentPlan) {
            await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans`, {
              method: 'POST',
              headers: { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' },
              body: JSON.stringify({ ...parentPlan, scope })
            }).catch(() => {});
          }
          await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/todos`, {
            method: 'POST',
            headers: { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({ ...todo, scope })
          }).catch(() => {});
        }

        await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs?todo_id=eq.${todoId}&scope=eq.${scope}`, {
          method: 'DELETE',
          headers: this._getCloudHeaders()
        }).catch(() => {});

        await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/do_logs`, {
          method: 'POST',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({
            id: newLog.id,
            todo_id: todoId,
            scope,
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

    const data = this._loadScopeData(scope);
    const targetPlan = data.plans.find(p => String(p.id) === String(reviewData.plan_id) && p.scope === scope);
    if (!targetPlan) {
      throw new Error('계획을 찾을 수 없거나 접근이 거부되었습니다. (PostgreSQL RLS 404/403)');
    }

    const newReview = {
      id: crypto.randomUUID(),
      ...payload,
      scope: scope,
      created_at: new Date().toISOString()
    };
    data.see_reviews.unshift(newReview);
    this._saveScopeData(scope, data);

    if (this.isCloudConfigured) {
      try {
        await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/plans`, {
          method: 'POST',
          headers: { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ ...targetPlan, scope })
        }).catch(() => {});

        await fetch(`${CONFIG.SUPABASE.URL}/rest/v1/see_reviews`, {
          method: 'POST',
          headers: this._getCloudHeaders(),
          body: JSON.stringify({ ...payload, id: newReview.id, scope })
        });
      } catch (err) {
        console.warn('Cloud createSeeReview sync warning:', err.message);
      }
    }

    return { ...newReview, adjustment_insight: cleanInsight };
  }

  async purgeActiveScope() {
    const scope = this.currentScope;

    const cleared = {
      scope: scope,
      plans: [],
      plan_histories: [],
      todos: [],
      do_logs: [],
      see_reviews: []
    };
    this._saveScopeData(scope, cleared);

    if (this.isCloudConfigured) {
      try {
        const url = `${CONFIG.SUPABASE.URL}/rest/v1`;
        const headers = this._getCloudHeaders();
        await Promise.all([
          fetch(`${url}/see_reviews?scope=eq.${scope}`, { method: 'DELETE', headers }),
          fetch(`${url}/do_logs?scope=eq.${scope}`, { method: 'DELETE', headers }),
          fetch(`${url}/todos?scope=eq.${scope}`, { method: 'DELETE', headers }),
          fetch(`${url}/plan_histories?scope=eq.${scope}`, { method: 'DELETE', headers }),
          fetch(`${url}/plans?scope=eq.${scope}`, { method: 'DELETE', headers })
        ]);
      } catch (err) {
        console.warn('Cloud scope purge sync warning:', err.message);
      }
    }

    return { success: true, scope };
  }

  async populateSyntheticSeed(scope = this.currentScope) {
    const seed = this._createSeedData(scope);
    this._saveScopeData(scope, seed);

    if (this.isCloudConfigured) {
      try {
        const url = `${CONFIG.SUPABASE.URL}/rest/v1`;
        const headers = { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' };
        if (seed.plans.length > 0) {
          await fetch(`${url}/plans`, { method: 'POST', headers, body: JSON.stringify(seed.plans) }).catch(() => {});
        }
        if (seed.todos.length > 0) {
          await fetch(`${url}/todos`, { method: 'POST', headers, body: JSON.stringify(seed.todos) }).catch(() => {});
        }
        if (seed.do_logs.length > 0) {
          await fetch(`${url}/do_logs`, { method: 'POST', headers, body: JSON.stringify(seed.do_logs) }).catch(() => {});
        }
      } catch (err) {
        console.warn('Cloud populateSyntheticSeed sync warning:', err.message);
      }
    }

    return { success: true, scope };
  }

  async restoreScopeBackup(validatedPayload) {
    const scope = this.currentScope;
    const existing = this._loadScopeData(scope);

    // Encrypt sensitive fields for safe at-rest storage
    const encryptedPlans = await Promise.all((validatedPayload.plans || []).map(async p => ({
      ...p,
      scope,
      success_criteria: p.success_criteria ? await encryptText(p.success_criteria) : ''
    })));
    const encryptedHistories = await Promise.all((validatedPayload.plan_histories || []).map(async h => ({
      ...h,
      scope,
      success_criteria: h.success_criteria ? await encryptText(h.success_criteria) : ''
    })));
    const encryptedTodos = await Promise.all((validatedPayload.todos || []).map(async t => ({
      ...t,
      scope,
      description: t.description ? await encryptText(t.description) : ''
    })));
    const encryptedLogs = await Promise.all((validatedPayload.do_logs || []).map(async l => ({
      ...l,
      scope,
      blocked_reason: l.blocked_reason ? await encryptText(l.blocked_reason) : ''
    })));
    const encryptedReviews = await Promise.all((validatedPayload.see_reviews || []).map(async r => ({
      ...r,
      scope,
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
      scope,
      plans: Array.from(planMap.values()),
      plan_histories: Array.from(historyMap.values()),
      todos: Array.from(todoMap.values()),
      do_logs: Array.from(logMap.values()),
      see_reviews: Array.from(reviewMap.values())
    };

    this._saveScopeData(scope, merged);

    if (this.isCloudConfigured) {
      try {
        const url = `${CONFIG.SUPABASE.URL}/rest/v1`;
        const headers = { ...this._getCloudHeaders(), 'Prefer': 'resolution=merge-duplicates' };
        if (merged.plans.length > 0) {
          await fetch(`${url}/plans`, { method: 'POST', headers, body: JSON.stringify(merged.plans) }).catch(() => {});
        }
        if (merged.plan_histories.length > 0) {
          await fetch(`${url}/plan_histories`, { method: 'POST', headers, body: JSON.stringify(merged.plan_histories) }).catch(() => {});
        }
        if (merged.todos.length > 0) {
          await fetch(`${url}/todos`, { method: 'POST', headers, body: JSON.stringify(merged.todos) }).catch(() => {});
        }
        if (merged.do_logs.length > 0) {
          await fetch(`${url}/do_logs`, { method: 'POST', headers, body: JSON.stringify(merged.do_logs) }).catch(() => {});
        }
        if (merged.see_reviews.length > 0) {
          await fetch(`${url}/see_reviews`, { method: 'POST', headers, body: JSON.stringify(merged.see_reviews) }).catch(() => {});
        }
      } catch (err) {
        console.warn('Cloud restoreScopeBackup sync warning:', err.message);
      }
    }

    return { success: true, count: merged.plans.length };
  }
}

export const dbClient = new SupabaseScopeEngine();
