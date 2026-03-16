/**
 * Supabase Client for Vercel API
 * Enhanced with helper functions for common operations
 */

import { createClient } from '@supabase/supabase-js';
import { createDbOperationError, logDbFailure } from './db-logger.js';

/**
 * Get Supabase client instance
 * @param {Object} env - Environment variables (process.env in Vercel)
 * @returns {Object} Supabase client
 */
export function getSupabaseClient(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  // Prefer Service Role Key for Server-Side operations to bypass RLS
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials not found in environment');
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Initialize KV-like stores using Supabase
 * NOTE: Adapted to return the raw client since we are moving away from KV tables
 * to proper Relational Tables.
 * @param {Object} env - Environment variables
 * @returns {Object} KV stores
 */
export function initializeKVStores(env = process.env) {
  const supabase = getSupabaseClient(env);

  // Return proxies that throw helpful errors if legacy KV code is hit,
  // or simple wrappers if we want to maintain compatibility (but mapped to real tables).
  // For now, we return the raw client as 'supabase' which is what we will use.

  return {
    supabase,
    // Mock KV stores to prevent crashes if I missed a spot, but logs error
    KV_ADMIN: createMockKV('admin', supabase),
    KV_PINS: createMockKV('pins', supabase),
    KV_QUEUES: createMockKV('queue', supabase),
    KV_EVENTS: createMockKV('events', supabase),
    KV_LOCKS: createMockKV('locks', supabase),
    KV_CACHE: createMockKV('cache', supabase),
  };
}

function createMockKV(name, supabase) {
  return {
    get: async (key, type = 'text') => {
      const compositeKey = `${name}:${key}`;
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('value_text, value_json')
          .eq('key', compositeKey)
          .maybeSingle();

        if (error) {
          throw createDbOperationError('DB_KV_GET_FAILED', `Failed to read key ${compositeKey} from settings`, error);
        }

        if (!data) return null;
        if (type === 'json') {
          return data.value_json ?? JSON.parse(data.value_text);
        }

        return data.value_text;
      } catch (e) {
        logDbFailure('DB_KV_GET_FAILED', { store: name, key: compositeKey }, e);
        throw createDbOperationError('DB_KV_GET_FAILED', `KV get failed for ${compositeKey}`, e);
      }
    },
    put: async (key, val) => {
      const compositeKey = `${name}:${key}`;
      try {
        const isObject = typeof val === 'object' && val !== null;
        const valueText = isObject ? JSON.stringify(val) : String(val);
        const { error } = await supabase
          .from('settings')
          .upsert({ 
            key: compositeKey,
            namespace: name,
            value_text: valueText,
            value_json: isObject ? val : null,
            updated_at: new Date().toISOString()
          }, { onConflict: 'namespace,key' });

        if (error) throw error;
        return true;
      } catch (e) {
        logDbFailure('DB_KV_PUT_FAILED', { store: name, key: compositeKey }, e);
        throw createDbOperationError('DB_KV_PUT_FAILED', `KV put failed for ${compositeKey}`, e);
      }
    },
    list: async (options = {}) => {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('key')
          .like('key', `${name}:%`);

        if (error) throw error;
        return { keys: (data || []).map(d => ({ name: d.key.replace(`${name}:`, '') })) };
      } catch (e) {
        logDbFailure('DB_KV_LIST_FAILED', { store: name, options }, e);
        throw createDbOperationError('DB_KV_LIST_FAILED', `KV list failed for ${name}`, e);
      }
    },
    delete: async (key) => {
      const compositeKey = `${name}:${key}`;
      try {
        const { error } = await supabase
          .from('settings')
          .delete()
          .eq('key', compositeKey);

        if (error) throw error;
        return true;
      } catch (e) {
        logDbFailure('DB_KV_DELETE_FAILED', { store: name, key: compositeKey }, e);
        throw createDbOperationError('DB_KV_DELETE_FAILED', `KV delete failed for ${compositeKey}`, e);
      }
    }
  };
}
