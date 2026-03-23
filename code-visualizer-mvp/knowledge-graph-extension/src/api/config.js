// src/api/config.js
// API Configuration
// 
// SETUP INSTRUCTIONS:
// 1. Create a Supabase project at https://supabase.com
// 2. Copy your project URL and anon key from Settings > API
// 3. Set these values below OR use environment variables
// 4. For production, use environment variables in your build process

const API_CONFIG = {
  // Supabase Configuration
  // Get these from: https://supabase.com/dashboard/project/_/settings/api
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key-here',
  
  // API Settings
  API_BASE_URL: 'https://api.updateai.app',
  API_TIMEOUT: 30000,
  API_RETRY_ATTEMPTS: 3,
  API_RETRY_DELAY: 1000,
  
  // Sync Configuration
  SYNC_MAX_RETRY_ATTEMPTS: 10,
  SYNC_BASE_BACKOFF_DELAY: 1000,
  SYNC_MAX_BACKOFF_DELAY: 5 * 60 * 1000, // 5 minutes
  SYNC_BATCH_SIZE: 10,
  SYNC_PERIODIC_INTERVAL: 5 * 60 * 1000, // 5 minutes
  SYNC_PULL_INTERVAL: 10 * 60 * 1000, // 10 minutes
  
  // Storage Configuration
  STORAGE_QUOTA_THRESHOLD: 0.9, // 90% of quota
  STORAGE_MAX_CONFLICTS: 50,
  STORAGE_MAX_FAILURES: 100,
  
  // Feature Flags
  ENABLE_OFFLINE_MODE: true,
  ENABLE_REAL_TIME: true,
  ENABLE_COLLABORATION: true,
  
  // Development Mode
  IS_DEV: false, // Set to true for local development
};

// Validate configuration
function validateConfig() {
  const errors = [];
  
  if (!API_CONFIG.SUPABASE_URL || API_CONFIG.SUPABASE_URL === 'https://your-project.supabase.co') {
    errors.push('SUPABASE_URL is not configured. Please set it in src/api/config.js');
  }
  
  if (!API_CONFIG.SUPABASE_ANON_KEY || API_CONFIG.SUPABASE_ANON_KEY === 'your-anon-key-here') {
    errors.push('SUPABASE_ANON_KEY is not configured. Please set it in src/api/config.js');
  }
  
  if (errors.length > 0) {
    console.error('[UpdateAI Config] Configuration errors:', errors);
    if (!API_CONFIG.IS_DEV) {
      console.warn('[UpdateAI Config] Extension will run in offline-only mode until configured.');
    }
  }
  
  return errors.length === 0;
}

// Check configuration on load
const isConfigValid = validateConfig();

export default API_CONFIG;
export { isConfigValid };
