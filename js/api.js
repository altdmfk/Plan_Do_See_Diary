/**
 * Plan-Do-See Diary - Data Access API Layer
 * Mediates all requests, enforces session scope, and integrates atomic import/export.
 */

import { dbClient } from './supabaseClient.js';
import { validateFileSize, migrateLegacySchema, validateImportPayload } from './validators.js';

export const API = {
  getScope() {
    return dbClient.getSessionScope();
  },

  setScope(scope) {
    dbClient.setSessionScope(scope);
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

  async purgeCurrentScope() {
    return await dbClient.purgeActiveScope();
  },

  async populateSyntheticSeed() {
    return await dbClient.populateSyntheticSeed();
  },

  async exportBackup() {
    const data = await dbClient.fetchAll();
    return {
      version: '2.0.0',
      exported_at: new Date().toISOString(),
      scope: dbClient.getSessionScope(),
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

    const currentScope = dbClient.getSessionScope();

    // 3. Legacy Migration
    const migrated = migrateLegacySchema(rawObj, currentScope);

    // 4. All-or-Nothing Schema Validation
    const validated = validateImportPayload(migrated, currentScope);

    // 5. Commit to database
    return await dbClient.restoreScopeBackup(validated);
  },

  async migrateLocalData() {
    const scope = dbClient.getSessionScope();
    const key = `pds_db_v2_${scope}`;
    let raw = null;
    if (typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(key);
    }
    if (!raw) throw new Error('로컬 데이터를 찾을 수 없습니다.');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error('로컬 데이터 파싱 실패.');
    }

    const migrated = migrateLegacySchema({ ...parsed, scope }, scope);
    const validated = validateImportPayload(migrated, scope);
    const result = await dbClient.restoreScopeBackup(validated);

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
    return result;
  }
};
