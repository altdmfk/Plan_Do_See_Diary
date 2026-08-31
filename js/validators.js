/**
 * Plan-Do-See Diary - Import Validator, Rollback Engine & Legacy Migrator
 * Features strict schema validation, bounds enforcement, prototype pollution defense, and legacy v1 migration.
 */

import { CONFIG } from './config.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STRING_LEN = 2000;
const MAX_TITLE_LEN = 255;
const MAX_MINUTES = 500000;

/**
 * Validates an import payload file size
 */
export function validateFileSize(fileSizeBytes) {
  if (fileSizeBytes > CONFIG.MAX_IMPORT_SIZE_BYTES) {
    const sizeMb = (fileSizeBytes / (1024 * 1024)).toFixed(2);
    throw new Error(`Import payload exceeds 5MB limit (${sizeMb} MB).`);
  }
}

/**
 * Clean and sanitize text string
 */
export function sanitizeText(val, maxLen = MAX_STRING_LEN) {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}
export const sanitizeString = sanitizeText;

/**
 * Clean and clamp numeric bounds
 */
export function clampNum(val, min = 0, max = MAX_MINUTES) {
  const num = Number(val);
  if (isNaN(num) || num < min) return min;
  if (num > max) return max;
  return num;
}
export const clampNumber = clampNum;

/**
 * Defend against Prototype Pollution attacks on imported JSON objects
 */
function isSafeKey(key) {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/**
 * Migrates legacy schema (v1) to active schema (v2)
 */
export function migrateLegacySchema(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error('Import data must be a valid JSON object.');
  }

  const payload = JSON.parse(JSON.stringify(rawPayload));
  const isV1 = !payload.version || payload.version === '1.0' || payload.version === '1.0.0' || String(payload.version).startsWith('1.') || Array.isArray(payload);

  if (!isV1) {
    return payload;
  }

  // Handle flat array or legacy v1 structure
  const migrated = {
    version: '2.0.0',
    exported_at: new Date().toISOString(),
    plans: [],
    plan_histories: [],
    todos: [],
    do_logs: [],
    see_reviews: []
  };

  if (Array.isArray(payload)) {
    // Array of plans or todos
    for (const item of payload) {
      if (item && typeof item === 'object') {
        if (item.period_start || item.plan_title || item.success_criteria) {
          migrated.plans.push({
            id: item.id || crypto.randomUUID(),
            title: sanitizeString(item.title || item.plan_title || 'Migrated Plan', MAX_TITLE_LEN),
            period_start: item.period_start || item.start_date || '2026-01-01',
            period_end: item.period_end || item.end_date || '2026-01-07',
            priority: item.priority || 'medium',
            success_criteria: sanitizeString(item.success_criteria || item.criteria || ''),
            estimated_hours: clampNumber(item.estimated_hours || (item.estimated_minutes ? item.estimated_minutes / 60 : 0)),
            status: item.status || 'active',
            created_at: item.created_at || new Date().toISOString(),
            updated_at: item.updated_at || new Date().toISOString()
          });
        }
      }
    }
  } else {
    // Structured legacy object
    const rawPlans = Array.isArray(payload.plans) ? payload.plans : (Array.isArray(payload.plan_list) ? payload.plan_list : []);
    for (const p of rawPlans) {
      if (p && typeof p === 'object') {
        migrated.plans.push({
          id: p.id || crypto.randomUUID(),
          title: sanitizeString(p.title || p.plan_title || 'Migrated Plan', MAX_TITLE_LEN),
          period_start: p.period_start || p.start_date || '2026-01-01',
          period_end: p.period_end || p.end_date || '2026-01-07',
          priority: p.priority || 'medium',
          success_criteria: sanitizeString(p.success_criteria || p.criteria || ''),
          estimated_hours: clampNumber(p.estimated_hours || (p.estimated_minutes ? p.estimated_minutes / 60 : 0)),
          status: p.status || 'active',
          created_at: p.created_at || new Date().toISOString(),
          updated_at: p.updated_at || new Date().toISOString()
        });
      }
    }

    const rawTodos = Array.isArray(payload.todos) ? payload.todos : (Array.isArray(payload.tasks) ? payload.tasks : []);
    for (const t of rawTodos) {
      if (t && typeof t === 'object') {
        const rawTags = Array.isArray(t.tags) ? t.tags : [];
        const cleanTags = rawTags.map(tg => sanitizeString(tg, 50)).filter(Boolean);

        migrated.todos.push({
          id: t.id || crypto.randomUUID(),
          plan_id: t.plan_id || (migrated.plans[0]?.id || crypto.randomUUID()),
          title: sanitizeString(t.title || t.task_name || 'Migrated ToDo', MAX_TITLE_LEN),
          description: sanitizeString(t.description || ''),
          due_date: t.due_date || t.deadline || '2026-01-07',
          priority: t.priority || 'medium',
          tags: cleanTags,
          estimated_minutes: clampNumber(t.estimated_minutes || t.est_minutes || 0),
          is_completed: Boolean(t.is_completed || t.completed),
          completed_at: t.completed_at || (t.is_completed ? new Date().toISOString() : null),
          sort_order: clampNumber(t.sort_order || 0, 0, 10000),
          created_at: t.created_at || new Date().toISOString(),
          updated_at: t.updated_at || new Date().toISOString()
        });
      }
    }

    const rawLogs = Array.isArray(payload.do_logs) ? payload.do_logs : (Array.isArray(payload.executions) ? payload.executions : []);
    for (const l of rawLogs) {
      if (l && typeof l === 'object') {
        migrated.do_logs.push({
          id: l.id || crypto.randomUUID(),
          todo_id: l.todo_id || (migrated.todos[0]?.id || crypto.randomUUID()),
          execution_start: l.execution_start || l.start_time || new Date().toISOString(),
          execution_end: l.execution_end || l.end_time || new Date().toISOString(),
          actual_minutes: clampNumber(l.actual_minutes || l.duration_minutes || 0),
          blocked_reason: sanitizeString(l.blocked_reason || l.blocker || l.block_reason || ''),
          completion_token: l.completion_token || crypto.randomUUID(),
          created_at: l.created_at || new Date().toISOString()
        });
      }
    }
  }

  return migrated;
}

/**
 * Validates the entire import data package.
 * Throws a detailed error if any item violates schema rules.
 */
export function validateImportPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Import data must be a valid JSON object.');
  }

  // Defend against prototype pollution
  for (const key of Object.keys(payload)) {
    if (!isSafeKey(key)) {
      throw new Error(`Forbidden key detected in payload: ${key}`);
    }
  }

  const seenIds = new Set();
  const errors = [];

  function checkId(id, entityName) {
    if (!id || typeof id !== 'string') {
      errors.push(`${entityName}: Missing or invalid ID.`);
      return;
    }
    if (seenIds.has(id)) {
      errors.push(`${entityName}: Duplicate primary key ID detected (${id}).`);
    }
    seenIds.add(id);
  }

  function checkDate(dateStr, fieldName) {
    if (!dateStr || !DATE_REGEX.test(dateStr)) {
      errors.push(`Invalid date format for ${fieldName}: expected YYYY-MM-DD.`);
    }
  }

  // 1. Validate Plans
  const plans = Array.isArray(payload.plans) ? payload.plans : [];
  plans.forEach((p, idx) => {
    checkId(p.id, `Plan #${idx + 1}`);
    if (!p.title || typeof p.title !== 'string') errors.push(`Plan #${idx + 1}: Missing title.`);
    checkDate(p.period_start, `Plan #${idx + 1} period_start`);
    checkDate(p.period_end, `Plan #${idx + 1} period_end`);
    p.title = sanitizeString(p.title, MAX_TITLE_LEN);
    p.success_criteria = sanitizeString(p.success_criteria);
    p.estimated_hours = clampNumber(p.estimated_hours);
  });

  // 2. Validate Plan Histories
  const histories = Array.isArray(payload.plan_histories) ? payload.plan_histories : [];
  histories.forEach((h, idx) => {
    checkId(h.id, `PlanHistory #${idx + 1}`);
    if (!h.plan_id) errors.push(`PlanHistory #${idx + 1}: Missing plan_id.`);
    h.title = sanitizeString(h.title, MAX_TITLE_LEN);
    h.success_criteria = sanitizeString(h.success_criteria);
    h.reason = sanitizeString(h.reason, 500);
  });

  // 3. Validate ToDos
  const todos = Array.isArray(payload.todos) ? payload.todos : [];
  todos.forEach((t, idx) => {
    checkId(t.id, `ToDo #${idx + 1}`);
    if (!t.title) errors.push(`ToDo #${idx + 1}: Missing title.`);
    if (!t.plan_id) errors.push(`ToDo #${idx + 1}: Missing plan_id.`);
    checkDate(t.due_date, `ToDo #${idx + 1} due_date`);
    t.title = sanitizeString(t.title, MAX_TITLE_LEN);
    t.description = sanitizeString(t.description);
    t.tags = (Array.isArray(t.tags) ? t.tags : []).map(tg => sanitizeString(tg, 50)).filter(Boolean);
    t.estimated_minutes = clampNumber(t.estimated_minutes);
  });

  // 4. Validate Do Logs
  const doLogs = Array.isArray(payload.do_logs) ? payload.do_logs : [];
  doLogs.forEach((l, idx) => {
    checkId(l.id, `DoLog #${idx + 1}`);
    if (!l.todo_id) errors.push(`DoLog #${idx + 1}: Missing todo_id.`);
    if (!l.execution_start || !l.execution_end) errors.push(`DoLog #${idx + 1}: Missing execution timestamps.`);
    l.blocked_reason = sanitizeString(l.blocked_reason);
    l.actual_minutes = clampNumber(l.actual_minutes);
  });

  // 5. Validate See Reviews
  const seeReviews = Array.isArray(payload.see_reviews) ? payload.see_reviews : [];
  seeReviews.forEach((r, idx) => {
    checkId(r.id, `SeeReview #${idx + 1}`);
    if (!r.plan_id) errors.push(`SeeReview #${idx + 1}: Missing plan_id.`);
    checkDate(r.review_date, `SeeReview #${idx + 1} review_date`);
    r.adjustment_insight = sanitizeString(r.adjustment_insight);
    r.planned_count = clampNumber(r.planned_count);
    r.completed_count = clampNumber(r.completed_count);
    r.delayed_count = clampNumber(r.delayed_count);
    r.blocked_count = clampNumber(r.blocked_count);
  });

  if (errors.length > 0) {
    throw new Error(`Validation failed with ${errors.length} issue(s):\n• ` + errors.slice(0, 5).join('\n• '));
  }

  return {
    version: '2.0.0',
    plans,
    plan_histories: histories,
    todos,
    do_logs: doLogs,
    see_reviews: seeReviews
  };
}
