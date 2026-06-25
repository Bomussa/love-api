/**
 * Supabase Client for Vercel API
 * Enhanced with helper functions for common operations
 */

import { createClient } from '@supabase/supabase-js';

const MEMORY_SUPABASE_KEY = '__LOVE_API_MEMORY_SUPABASE__';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getMemoryState() {
  if (!globalThis[MEMORY_SUPABASE_KEY]) {
    globalThis[MEMORY_SUPABASE_KEY] = {
      tables: new Map(),
    };
  }
  return globalThis[MEMORY_SUPABASE_KEY];
}

function getMemoryTable(state, tableName) {
  if (!state.tables.has(tableName)) {
    state.tables.set(tableName, []);
  }
  return state.tables.get(tableName);
}

function matchesLike(value, pattern) {
  const haystack = String(value ?? '');
  const needle = String(pattern ?? '').replace(/%/g, '');
  return haystack.includes(needle);
}

class MemoryQuery {
  constructor(state, tableName) {
    this.state = state;
    this.tableName = tableName;
    this.kind = 'select';
    this.rows = [];
    this.filters = [];
    this.sort = null;
    this.limitCount = null;
    this.head = false;
    this.countMode = null;
    this.payload = null;
    this.deleteMode = false;
    this.singleMode = false;
  }

  select(columns = '*', options = {}) {
    this.kind = 'select';
    this.columns = columns;
    this.head = Boolean(options?.head);
    this.countMode = options?.count || null;
    return this;
  }

  upsert(payload) {
    this.kind = 'upsert';
    this.payload = payload;
    return this;
  }

  delete() {
    this.kind = 'delete';
    this.deleteMode = true;
    return this;
  }

  eq(field, value) {
    this.filters.push({ type: 'eq', field, value });
    return this;
  }

  in(field, values) {
    this.filters.push({ type: 'in', field, values: Array.isArray(values) ? values : [] });
    return this;
  }

  like(field, pattern) {
    this.filters.push({ type: 'like', field, pattern });
    return this;
  }

  order(field, options = {}) {
    this.sort = { field, ascending: options.ascending !== false };
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  maybeSingle() {
    this.singleMode = 'maybe';
    return this;
  }

  single() {
    this.singleMode = 'strict';
    return this;
  }

  async run() {
    const table = getMemoryTable(this.state, this.tableName);

    if (this.kind === 'upsert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const key = row.key ?? row.id ?? null;
        if (key !== null) {
          const index = table.findIndex((item) => item && (item.key === key || item.id === key));
          if (index >= 0) {
            table[index] = { ...table[index], ...clone(row) };
            continue;
          }
        }
        table.push(clone(row));
      }
      return { data: clone(rows), error: null };
    }

    let rows = table.map(clone);

    for (const filter of this.filters) {
      if (filter.type === 'eq') {
        rows = rows.filter((row) => String(row?.[filter.field]) === String(filter.value));
      } else if (filter.type === 'in') {
        rows = rows.filter((row) => filter.values.some((v) => String(row?.[filter.field]) === String(v)));
      } else if (filter.type === 'like') {
        rows = rows.filter((row) => matchesLike(row?.[filter.field], filter.pattern));
      }
    }

    if (this.sort) {
      const { field, ascending } = this.sort;
      rows.sort((a, b) => {
        const av = String(a?.[field] ?? '');
        const bv = String(b?.[field] ?? '');
        if (av === bv) return 0;
        return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    if (this.limitCount !== null) {
      rows = rows.slice(0, this.limitCount);
    }

    if (this.deleteMode) {
      const before = table.length;
      const remaining = table.filter((row) => {
        return !this.filters.every((filter) => {
          if (filter.type === 'eq') return String(row?.[filter.field]) === String(filter.value);
          if (filter.type === 'in') return filter.values.some((v) => String(row?.[filter.field]) === String(v));
          if (filter.type === 'like') return matchesLike(row?.[filter.field], filter.pattern);
          return true;
        });
      });
      this.state.tables.set(this.tableName, remaining);
      return { data: before - remaining.length, error: null };
    }

    if (this.head && this.countMode === 'exact') {
      return { count: rows.length, error: null, data: null };
    }

    if (this.singleMode === 'strict') {
      if (!rows.length) {
        return { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
      }
      return { data: rows[0], error: null };
    }

    if (this.singleMode === 'maybe') {
      return { data: rows[0] ?? null, error: null };
    }

    return { data: rows, error: null };
  }

  then(resolve, reject) {
    return this.run().then(resolve, reject);
  }

  catch(reject) {
    return this.run().catch(reject);
  }

  finally(handler) {
    return this.run().finally(handler);
  }
}

function createMemorySupabaseClient() {
  const state = getMemoryState();

  return {
    from(tableName) {
      return new MemoryQuery(state, tableName);
    },
    async rpc(name, args = {}) {
      if (name === 'add_to_queue_atomic') {
        const table = getMemoryTable(state, 'unified_queue');
        const display_number = table.length + 1;
        const row = {
          id: `mem_${display_number}`,
          display_number,
          queue_length: display_number,
          status: 'waiting',
          clinic_id: args.p_clinic_id ?? args.clinic_id ?? null,
          patient_id: args.p_patient_id ?? args.patient_id ?? null,
          exam_type: args.p_exam_type ?? args.exam_type ?? null,
          entered_at: new Date().toISOString(),
        };
        table.push(row);
        return { data: row, error: null };
      }

      if (name === 'call_next_patient') {
        const table = getMemoryTable(state, 'unified_queue');
        const clinicId = args.p_clinic_id ?? args.clinic_id ?? null;
        const current = table.find((row) => String(row.clinic_id) === String(clinicId) && row.status === 'waiting');
        if (!current) {
          return { data: null, error: null };
        }
        current.status = 'called';
        current.called_at = new Date().toISOString();
        return { data: current, error: null };
      }

      if (name === 'finish_exam_record') {
        const table = getMemoryTable(state, 'unified_queue');
        const queueId = args.p_queue_id ?? args.queue_id ?? null;
        const current = table.find((row) => String(row.id) === String(queueId));
        if (current) {
          current.status = args.p_status === 'absent' ? 'no_show' : 'completed';
          current.completed_at = new Date().toISOString();
        }
        return { data: current ?? null, error: null };
      }

      return { data: null, error: null };
    },
  };
}

/**
 * Get Supabase client instance
 * @param {Object} env - Environment variables (process.env in Vercel)
 * @returns {Object} Supabase client
 */
export function getSupabaseClient(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  // Prefer Service Role Key for Server-Side operations to bypass RLS
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

  if (process.env.NODE_ENV === 'test' || process.env.LOVE_API_USE_MEMORY_SUPABASE === '1' || !supabaseUrl || !supabaseKey) {
    return createMemorySupabaseClient();
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
      console.log(`[KV Adapter] Get ${name}:${key}`);
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('value')
          .eq('key', `${name}:${key}`)
          .maybeSingle();
        
        if (error || !data) return null;
        return type === 'json' ? JSON.parse(data.value) : data.value;
      } catch (e) {
        console.error(`[KV Adapter] Error getting ${name}:${key}:`, e);
        return null;
      }
    },
    put: async (key, val) => {
      console.log(`[KV Adapter] Put ${name}:${key}`);
      try {
        const value = typeof val === 'object' ? JSON.stringify(val) : String(val);
        const { error } = await supabase
          .from('settings')
          .upsert({ 
            key: `${name}:${key}`, 
            value,
            updated_at: new Date().toISOString()
          });
        
        if (error) throw error;
        return true;
      } catch (e) {
        console.error(`[KV Adapter] Error putting ${name}:${key}:`, e);
        return false;
      }
    },
    list: async (options = {}) => {
      console.log(`[KV Adapter] List ${name}`);
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('key')
          .like('key', `${name}:%`);
        
        if (error) throw error;
        return { keys: (data || []).map(d => ({ name: d.key.replace(`${name}:`, '') })) };
      } catch (e) {
        console.error(`[KV Adapter] Error listing ${name}:`, e);
        return { keys: [] };
      }
    },
    delete: async (key) => {
      console.log(`[KV Adapter] Delete ${name}:${key}`);
      try {
        const { error } = await supabase
          .from('settings')
          .delete()
          .eq('key', `${name}:${key}`);
        
        if (error) throw error;
        return true;
      } catch (e) {
        console.error(`[KV Adapter] Error deleting ${name}:${key}:`, e);
        return false;
      }
    }
  };
}
