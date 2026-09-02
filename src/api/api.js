/**
 * Plan-Do-See Diary - Data Access API Layer
 * Mediates all requests, and integrates atomic import/export.
 */

import { dbClient } from './supabaseClient.js';
import { validateFileSize, migrateLegacySchema, validateImportPayload } from '../utils/validators.js';
import { decryptText, isEncrypted } from '../utils/crypto.js';
import { authClient } from '../auth/auth.js';

const LEGACY_STORAGE_KEYS = [
  'plan_do_see_backup',
  'pds_legacy_data',
  'pds_db_v2_scope_a',
  'pds_db_v2',
  'pds_plans_v2',
  'pds_plan_histories_v2',
  'pds_todos_v2',
  'pds_do_logs_v2',
  'pds_see_reviews_v2',
  'plans',
  'plan_histories',
  'todos',
  'do_logs',
  'see_reviews'
];

function getMigrationFlagKey() {
  const userId = authClient.getUserId();
  if (!userId) return 'pds_migrated_anon';
  return `pds_migrated_${userId}`;
}

function getLegacyLocalPayload() {
  if (typeof localStorage === 'undefined') return null;

  // 1. Unified full JSON payload keys
  for (const key of ['plan_do_see_backup', 'pds_legacy_data', 'pds_db_v2_scope_a', 'pds_db_v2']) {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const hasPlans = Array.isArray(parsed.plans) && parsed.plans.length > 0;
          const hasTodos = Array.isArray(parsed.todos) && parsed.todos.length > 0;
          const hasPlanList = Array.isArray(parsed.plan_list) && parsed.plan_list.length > 0;
          const hasTasks = Array.isArray(parsed.tasks) && parsed.tasks.length > 0;
          if (hasPlans || hasTodos || hasPlanList || hasTasks) {
            return raw;
          }
        }
      } catch (e) {}
    }
  }

  // 2. Multi-key legacy structures
  const parts = {
    plans: localStorage.getItem('plans') || localStorage.getItem('pds_plans_v2'),
    plan_histories: localStorage.getItem('plan_histories') || localStorage.getItem('pds_plan_histories_v2'),
    todos: localStorage.getItem('todos') || localStorage.getItem('pds_todos_v2'),
    do_logs: localStorage.getItem('do_logs') || localStorage.getItem('pds_do_logs_v2'),
    see_reviews: localStorage.getItem('see_reviews') || localStorage.getItem('pds_see_reviews_v2')
  };

  if (Object.values(parts).some(Boolean)) {
    try {
      const combined = Object.fromEntries(
        Object.entries(parts).map(([key, value]) => [key, value ? JSON.parse(value) : []])
      );
      if ((Array.isArray(combined.plans) && combined.plans.length > 0) || (Array.isArray(combined.todos) && combined.todos.length > 0)) {
        return JSON.stringify(combined);
      }
    } catch (e) {}
  }

  return null;
}

async function decryptLocalPayload(payload) {
  const decryptField = async (value) => {
    const decrypted = await decryptText(value);
    if (isEncrypted(value) && decrypted === value) {
      throw new Error('로컬 데이터 복호화에 실패했습니다. 기존 브라우저 프로필에서 다시 시도해 주세요.');
    }
    return decrypted;
  };

  const decryptRows = async (rows, field) => Promise.all((rows || []).map(async (row) => ({
    ...row,
    [field]: await decryptField(row[field])
  })));

  return {
    ...payload,
    plans: await decryptRows(payload.plans, 'success_criteria'),
    plan_histories: await decryptRows(payload.plan_histories, 'success_criteria'),
    todos: await decryptRows(payload.todos, 'description'),
    do_logs: await decryptRows(payload.do_logs, 'blocked_reason'),
    see_reviews: await decryptRows(payload.see_reviews, 'adjustment_insight')
  };
}

export const API = {
  clearSession() {
    dbClient.clearMemoryStore();
  },
  async fetchAll() {
    return await dbClient.fetchAll();
  },

  async createPlan(planData) {
    return await dbClient.createPlan(planData);
  },

  async updatePlan(planId, updates) {
    return await dbClient.updatePlan(planId, updates);
  },

  async deletePlan(planId) {
    return await dbClient.deletePlan(planId);
  },

  async createTodo(todoData) {
    return await dbClient.createTodo(todoData);
  },

  async updateTodo(todoId, updates) {
    return await dbClient.updateTodo(todoId, updates);
  },

  async deleteTodo(todoId) {
    return await dbClient.deleteTodo(todoId);
  },

  async completeTodoIdempotent(todoId, logData, completionToken) {
    return await dbClient.completeTodoIdempotent(todoId, logData, completionToken);
  },

  async addDoLog(todoIdOrLogData, maybeLogData) {
    return await dbClient.addDoLog(todoIdOrLogData, maybeLogData);
  },

  async createDoLog(todoIdOrLogData, maybeLogData) {
    return await dbClient.addDoLog(todoIdOrLogData, maybeLogData);
  },

  async deleteDoLog(logId) {
    return await dbClient.deleteDoLog(logId);
  },

  async updateDoLog(logId, updatedFields = {}) {
    const rawStart = updatedFields.execution_start || updatedFields.start_time;
    const rawEnd   = updatedFields.execution_end   || updatedFields.end_time;
    const payload = {
      execution_start: rawStart ? new Date(rawStart).toISOString() : undefined,
      execution_end:   rawEnd   ? new Date(rawEnd).toISOString()   : undefined,
      actual_minutes:  parseInt(
        updatedFields.actual_minutes !== undefined
          ? updatedFields.actual_minutes
          : updatedFields.duration_minutes,
        10
      ) || 0,
      blocked_reason: updatedFields.blocked_reason !== undefined
        ? String(updatedFields.blocked_reason).trim()
        : (updatedFields.blocker_reason !== undefined ? String(updatedFields.blocker_reason).trim() : ''),
      memo: updatedFields.memo !== undefined ? String(updatedFields.memo).trim() : ''
    };
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
    return await dbClient.updateDoLog(logId, payload);
  },

  getTodoActualMinutes(todoId) {
    return dbClient.getTodoActualMinutes(todoId);
  },

  async createSeeReview(reviewData) {
    return await dbClient.createSeeReview(reviewData);
  },

  async purgeUserData() {
    return await dbClient.purgeUserData();
  },

  async populateSyntheticSeed() {
    return await dbClient.populateSyntheticSeed();
  },

  async exportBackup() {
    const data = await dbClient.fetchAll();
    return {
      version: '2.0.0',
      exported_at: new Date().toISOString(),
      plans: data.plans || [],
      plan_histories: data.plan_histories || [],
      todos: data.todos || [],
      do_logs: data.do_logs || [],
      see_reviews: data.see_reviews || []
    };
  },

  async importBackup(rawJsonString, fileSizeBytes) {
    // 1. File size check (< 5MB)
    validateFileSize(fileSizeBytes);

    // 2. JSON Parse check
    let rawObj;
    try {
      rawObj = JSON.parse(rawJsonString);
    } catch (err) {
      throw new Error('Malformed JSON syntax: Unable to parse import file.');
    }

    // 3. Legacy Migration
    const migrated = migrateLegacySchema(rawObj);

    // 4. All-or-Nothing Schema Validation
    const validated = validateImportPayload(migrated);

    // 5. Commit to database
    return await dbClient.restoreBackup(validated);
  },

  hasPendingLocalMigration() {
    if (typeof localStorage === 'undefined') return false;
    return Boolean(getLegacyLocalPayload()) && !localStorage.getItem(getMigrationFlagKey());
  },

  async migrateLocalDataToUser() {
    const raw = getLegacyLocalPayload();
    if (!raw) throw new Error('로컬 데이터를 찾을 수 없습니다.');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error('로컬 데이터 파싱 실패.');
    }

    const decrypted = await decryptLocalPayload(parsed);
    const migrated = migrateLegacySchema(decrypted);
    const validated = validateImportPayload(migrated);
    const result = await dbClient.restoreBackup(validated, { plaintextCloud: true });

    if (typeof localStorage !== 'undefined') {
      LEGACY_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
      localStorage.setItem(getMigrationFlagKey(), 'true');
    }
    return result;
  },

  async migrateLocalData() {
    return this.migrateLocalDataToUser();
  }
};

export const updateDoLog = (logId, updates) => API.updateDoLog(logId, updates);

