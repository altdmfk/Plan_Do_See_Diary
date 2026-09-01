/**
 * Plan-Do-See Diary - Strict Date Calculation Engine
 * Supports KST (Asia/Seoul, UTC+9) and EDT/EST (America/New_York).
 */

import { CONFIG } from './config.js';

const KST_TIMEZONE = CONFIG.TIMEZONE.CANONICAL;
const NY_TIMEZONE = 'America/New_York';

/**
 * Format a date into components strictly in the target timezone
 */
export function getZoneParts(dateInput = new Date(), timeZone = KST_TIMEZONE) {
  const d = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date object passed to getZoneParts');
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(d);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    dateString: `${map.year}-${map.month}-${map.day}`,
    timeString: `${map.hour}:${map.minute}:${map.second}`
  };
}

export function getKSTParts(dateInput = new Date()) {
  return getZoneParts(dateInput, KST_TIMEZONE);
}

/**
 * Get current date in KST/EDT formatted as YYYY-MM-DD
 */
export function getKSTToday() {
  return getKSTParts(new Date()).dateString;
}

export function getZoneToday(timeZone = KST_TIMEZONE) {
  return getZoneParts(new Date(), timeZone).dateString;
}

/**
 * Format date string into YYYY-MM-DD in KST
 */
export function formatKSTDate(dateInput) {
  if (!dateInput) return '';
  return getKSTParts(dateInput).dateString;
}

/**
 * Format timestamp into YYYY-MM-DD HH:mm strictly converted to active timezone (KST or EDT)
 */
export function formatLocalizedDateTime(dateInput, lang = 'ko') {
  if (!dateInput) return '';
  const tz = lang === 'en' ? NY_TIMEZONE : KST_TIMEZONE;
  const parts = getZoneParts(dateInput, tz);
  const minPad = String(parts.minute).padStart(2, '0');
  const hourPad = String(parts.hour).padStart(2, '0');
  return `${parts.dateString} ${hourPad}:${minPad}`;
}

export function formatKSTDateTime(dateInput) {
  return formatLocalizedDateTime(dateInput, 'ko');
}

/**
 * Format timestamp into live ticking clock in KST or EDT
 */
export function formatKSTLiveClock(dateInput = new Date(), lang = 'ko') {
  const isEn = lang === 'en';
  const tz = isEn ? NY_TIMEZONE : KST_TIMEZONE;
  const label = isEn ? 'EDT' : 'KST';
  const parts = getZoneParts(dateInput, tz);
  const hourPad = String(parts.hour).padStart(2, '0');
  const minPad = String(parts.minute).padStart(2, '0');
  const secPad = String(parts.second).padStart(2, '0');
  return `${parts.dateString} ${hourPad}:${minPad}:${secPad} ${label}`;
}

/**
 * Get strict Monday-to-Sunday week boundary for a given KST date
 */
export function getKSTWeekRange(dateInput = new Date()) {
  const parts = getKSTParts(dateInput);
  const baseUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const dayOfWeek = new Date(baseUtc).getUTCDay();
  
  const diffToMonday = (dayOfWeek + 6) % 7;
  const mondayUtc = baseUtc - (diffToMonday * 24 * 60 * 60 * 1000);
  const sundayUtc = mondayUtc + (6 * 24 * 60 * 60 * 1000);

  const monDate = new Date(mondayUtc);
  const sunDate = new Date(sundayUtc);

  const startYear = monDate.getUTCFullYear();
  const startMonth = String(monDate.getUTCMonth() + 1).padStart(2, '0');
  const startDay = String(monDate.getUTCDate()).padStart(2, '0');

  const endYear = sunDate.getUTCFullYear();
  const endMonth = String(sunDate.getUTCMonth() + 1).padStart(2, '0');
  const endDay = String(sunDate.getUTCDate()).padStart(2, '0');

  return {
    start: `${startYear}-${startMonth}-${startDay}`,
    end: `${endYear}-${endMonth}-${endDay}`,
    label: `${startMonth}.${startDay} ~ ${endMonth}.${endDay}`
  };
}

/**
 * Check if two dates belong to the exact same KST week (Monday to Sunday)
 */
export function isSameKSTWeek(d1, d2) {
  if (!d1 || !d2) return false;
  const range1 = getKSTWeekRange(d1);
  const range2 = getKSTWeekRange(d2);
  return range1.start === range2.start && range1.end === range2.end;
}

/**
 * Get strict 1st of month to month-end boundary in KST (safely handles leap years)
 */
export function getKSTMonthRange(dateInput = new Date()) {
  const parts = getKSTParts(dateInput);
  const year = parts.year;
  const month = parts.month;

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const mStr = String(month).padStart(2, '0');
  const lastDayStr = String(lastDay).padStart(2, '0');

  return {
    start: `${year}-${mStr}-01`,
    end: `${year}-${mStr}-${lastDayStr}`,
    year,
    month,
    daysInMonth: lastDay
  };
}

/**
 * Calculate if a To Do is delayed strictly against KST today
 * Completed To Dos are never delayed.
 */
export function isDelayedKST(dueDate, isCompleted, status = null) {
  if (isCompleted || status === 'completed') return false;
  if (!dueDate) return false;
  const today = getKSTToday();
  return dueDate < today;
}

/**
 * Drift-safe duration calculation using absolute timestamp difference
 */
export function calculateElapsedMinutes(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return 0;
  return Math.max(1, Math.round((endMs - startMs) / (1000 * 60)));
}
