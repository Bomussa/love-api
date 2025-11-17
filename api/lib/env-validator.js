/**
 * Environment Variable Validator
 * Ensures all required variables are set before API starts
 */

export function validateEnv() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your Vercel environment variables configuration.'
    );
  }

  // Warn about optional variables
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY not set - admin operations will fail');
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.warn('⚠️ Vercel KV not configured - using in-memory storage (not persistent)');
  }

  console.log('✅ Environment validation passed');
  return true;
}

/**
 * Get environment info for debugging
 */
export function getEnvInfo() {
  return {
    supabase_configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    service_role_configured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    kv_configured: !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
    node_env: process.env.NODE_ENV || 'development'
  };
}
