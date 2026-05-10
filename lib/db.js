/**
 * Database Abstraction Layer for Cloudflare KV
 * This file provides a PostgreSQL-like interface for Cloudflare KV storage
 * Used by legacy API endpoints in src/pages/api/
 */

// In Cloudflare Pages Functions, env is passed via context
// This module exports functions that will be bound to the actual KV namespaces at runtime

const LEGACY_EMPTY_READ_MODE = Object.freeze({
  NONE: 'none',
  READS_ONLY: 'reads_only',
  ALL: 'all',
});

const READ_ONLY_SQL = /^\s*(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)\b/i;

export class NotImplementedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

class KVDatabaseAdapter {
  constructor() {
    this.env = null;
  }

  /**
   * Initialize with Cloudflare environment bindings
   * This should be called from the Pages Function context
   */
  init(env) {
    this.env = env;
  }

  logLegacyCall(sql, params = [], options = {}) {
    const payload = {
      adapter: 'KVDatabaseAdapter',
      event: 'legacy_db_query',
      hasEnv: Boolean(this.env),
      sql: String(sql ?? ''),
      paramsCount: Array.isArray(params) ? params.length : 0,
      allowEmptyReadFallback: Boolean(options.allowEmptyReadFallback),
      emptyReadMode: options.emptyReadMode ?? LEGACY_EMPTY_READ_MODE.NONE,
      timestamp: new Date().toISOString(),
    };

    console.warn('[db][legacy]', payload);
  }

  isReadQuery(sql) {
    return READ_ONLY_SQL.test(String(sql ?? ''));
  }

  canReturnEmptyRows(sql, options = {}) {
    if (!options.allowEmptyReadFallback) {
      return false;
    }

    if (options.emptyReadMode === LEGACY_EMPTY_READ_MODE.ALL) {
      return true;
    }

    if (options.emptyReadMode === LEGACY_EMPTY_READ_MODE.READS_ONLY) {
      return this.isReadQuery(sql);
    }

    return false;
  }

  /**
   * Simulate PostgreSQL query interface
   * Returns a promise that resolves to { rows: [] }
   */
  async query(sql, params = [], options = {}) {
    this.logLegacyCall(sql, params, options);

    if (!this.env) {
      if (this.canReturnEmptyRows(sql, options)) {
        return { rows: [] };
      }

      throw new NotImplementedError(
        'KVDatabaseAdapter backend is unavailable. Migrate this path to supported data-access modules.',
      );
    }

    // This is a stub - actual queries should use KV directly
    // Legacy code using this should be migrated to use KV namespaces
    return { rows: [] };
  }

  /**
   * Compatibility wrapper for legacy paths that intentionally tolerate empty reads.
   * Do not use in new code.
   */
  async queryLegacyTolerant(sql, params = [], options = {}) {
    return this.query(sql, params, {
      allowEmptyReadFallback: true,
      emptyReadMode: LEGACY_EMPTY_READ_MODE.READS_ONLY,
      ...options,
    });
  }

  /**
   * Get a client for transaction-like operations
   */
  async getClient() {
    const self = this;
    return {
      query: async (sql, params, options) => await self.query(sql, params, options),
      queryLegacyTolerant: async (sql, params, options) => await self.queryLegacyTolerant(sql, params, options),
      release: () => {
        // No-op for KV
      },
    };
  }
}

// Export singleton instance
const db = new KVDatabaseAdapter();

export default db;

/**
 * Helper function to initialize db with environment
 * Should be called from Pages Functions middleware
 */
export function initDB(env) {
  db.init(env);
  return db;
}

export { LEGACY_EMPTY_READ_MODE };
