/**
 * Central environment loader/validator for Node, browser (Vite), and Deno runtimes.
 */

function readRawEnv(key) {
  if (typeof process !== 'undefined' && process?.env && key in process.env) {
    return process.env[key];
  }

  if (typeof Deno !== 'undefined' && Deno?.env?.get) {
    return Deno.env.get(key);
  }

  const metaEnv = globalThis?.__VITE_ENV__ || globalThis?.import_meta_env;
  if (metaEnv && key in metaEnv) {
    return metaEnv[key];
  }

  return undefined;
}

export function getEnv(key, options = {}) {
  const { required = false, aliases = [], context = 'application startup' } = options;
  const keys = [key, ...aliases];

  for (const candidate of keys) {
    const value = readRawEnv(candidate);
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  if (required) {
    throw new Error(
      `[ENV] Missing required environment variable for ${context}: ${keys.join(' or ')}`
    );
  }

  return undefined;
}

export function validateStartupEnv(requiredSets) {
  const missing = [];

  requiredSets.forEach(({ key, aliases = [], description = key }) => {
    try {
      getEnv(key, { required: true, aliases, context: 'service startup' });
    } catch {
      missing.push(`${description} (${[key, ...aliases].join(' or ')})`);
    }
  });

  if (missing.length > 0) {
    throw new Error(
      '[ENV] Startup validation failed. Missing variables: ' + missing.join(', ')
    );
  }
}

export function loadSupabaseRuntimeEnv() {
  const supabaseUrl = getEnv('SUPABASE_URL', {
    required: true,
    aliases: ['VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'],
    context: 'Supabase client initialization',
  });

  const supabaseServiceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', {
    aliases: ['SUPABASE_KEY'],
    context: 'Supabase privileged operations',
  });

  const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY', {
    aliases: ['VITE_SUPABASE_ANON_KEY'],
    context: 'Supabase public operations',
  });

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    supabaseAnonKey,
  };
}
