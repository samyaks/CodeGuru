const { createClient: supabaseCreateClient } = require('@supabase/supabase-js');

/**
 * Create a Supabase client configured for server-side auth.
 * @param {string} supabaseUrl - Your Supabase project URL
 * @param {string} supabaseAnonKey - Your Supabase anon/public key
 * @param {object} [options] - Additional Supabase client options
 */
function createClient(supabaseUrl, supabaseAnonKey, options = {}) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('@codeguru/auth: SUPABASE_URL and SUPABASE_ANON_KEY are required');
  }

  return supabaseCreateClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    ...options,
  });
}

module.exports = { createClient };
