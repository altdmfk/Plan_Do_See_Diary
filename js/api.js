/**
 * Plan-Do-See Diary - Data Access API Layer
 * Mediates all requests, and integrates atomic import/export.
 */

import { dbClient } from './supabaseClient.js';
import { validateFileSize, migrateLegacySchema, validateImportPayload } from './validators.js';
import { decryptText, isEncrypted } from './crypto.js';
import { authClient } from './auth.js';

const LEGACY_STORAGE_KEYS = [
  'pds_plans_v2',
  'pds_plan_histories_v2', 'pds_todos_v2', 'pds_do_logs_v2', 'pds_see_reviews_v2'
];

function getMigrationFlagKey() {
  const userId = authClient.getUserId();
  if (!userId) throw new Error('로그인 정보를 확인할 수 없습니다.');
  return `pds_migrated_${userId}`;
}

function getLegacyLocalPayload() {
  if (typeof localStorage === 'undefined') return null;
  for (const key of ['pds_db_v2']) {
    const raw = localStorage.getItem(key);
    if (raw) return raw;
  }
  const parts = {
    plans: localStorage.getItem('pds_plans_v2'),
    plan_histories: localStorage.getItem('pds_plan_histories_v2'),
    todos: localStorage.getItem('pds_todos_v2'),
    do_logs: localStorage.getItem('pds_do_logs_v2'),
    see_reviews: localStorage.getItem('pds_see_reviews_v2')
  };
  if (!Object.values(parts).some(Boolean)) return null;
  try {
    return JSON.stringify(Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, value ? JSON.parse(value) : []])));
  } catch {
    return null;
  }
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

  async addDoLog(todoId, logData) {
    return await dbClient.addDoLog(todoId, logData);
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
