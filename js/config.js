/**
 * Plan-Do-See Diary - Global Configuration & Constants
 */

export const CONFIG = {
  APP_NAME: 'Plan-Do-See Diary',
  VERSION: '2.0.0',
  SCHEMA_VERSION: 'v2',
  
  // Personas & Scopes (A/B Test Sessions)
  SCOPES: {
    SCOPE_A: 'scope_a',
    SCOPE_B: 'scope_b'
  },
  DEFAULT_SCOPE: 'scope_a',
  
  // Themes
  THEMES: {
    PASTEL_PINK: 'pastel-pink',
    FOREST_GREEN: 'forest-green',
    MODERN_BLACK: 'modern-black'
  },
  DEFAULT_THEME: 'pastel-pink',
  
  // Storage Keys
  STORAGE_KEYS: {
    ACTIVE_SCOPE: 'pds_active_scope',
    ACTIVE_THEME: 'pds_active_theme',
    DB_STORE_PREFIX: 'pds_db_v2_'
  },
  
  // Strict Timezone
  TIMEZONE: {
    CANONICAL: 'Asia/Seoul',
    OFFSET_HOURS: 9,
    WEEK_START_DAY: 1 // Monday (ISO-8601)
  },
  
  // Limits & Safeguards
  MAX_IMPORT_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB
  TOAST_DURATION_MS: 3500,

  // Synthetic Data Seeding Toggle (Set to false for completely blank diary)
  ENABLE_SYNTHETIC_SEED: true,
  
  // Supabase Configuration (Explicit Environment / Global Variables)
  SUPABASE: {
    URL: (typeof window !== 'undefined' && window.__PDS_SUPABASE_URL) || '',
    ANON_KEY: (typeof window !== 'undefined' && window.__PDS_SUPABASE_KEY) || ''
  }
};
