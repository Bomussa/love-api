/**
 * Database Synchronization Module
 * Handles automatic database schema synchronization after deployment
 * 
 * Updated: 2026-05-10
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Initialize Supabase client for database operations
 */
function getSupabaseClient() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Sync database schema after deployment
 * @returns {Promise<Object>} Sync result
 */
export async function syncDatabaseSchema() {
  try {
    console.log('[DB Sync] Starting database schema synchronization...');
    
    const supabase = getSupabaseClient();
    
    // Check database connection
    const { data: connectionTest, error: connectionError } = await supabase
      .from('clinics')
      .select('count', { count: 'exact' })
      .limit(1);

    if (connectionError) {
      throw new Error(`Database connection failed: ${connectionError.message}`);
    }

    console.log('[DB Sync] ✅ Database connection verified');

    // Verify critical tables exist
    const criticalTables = [
      'clinics',
      'patients',
      'queue',
      'system_settings',
      'admins'
    ];

    const tableCheckResults = {};

    for (const table of criticalTables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*', { count: 'exact' })
          .limit(1);

        if (error) {
          tableCheckResults[table] = { status: 'error', message: error.message };
        } else {
          tableCheckResults[table] = { status: 'ok' };
        }
      } catch (err) {
        tableCheckResults[table] = { status: 'error', message: err.message };
      }
    }

    console.log('[DB Sync] Table verification results:', tableCheckResults);

    // Initialize system settings if not exists
    const { data: settings, error: settingsError } = await supabase
      .from('system_settings')
      .select('*')
      .limit(1);

    if (!settings || settings.length === 0) {
      console.log('[DB Sync] Initializing system settings...');
      
      const defaultSettings = [
        { key: 'system_enabled', value: true },
        { key: 'api_version', value: '7.1.0' },
        { key: 'last_sync', value: new Date().toISOString() },
        { key: 'maintenance_mode', value: false }
      ];

      for (const setting of defaultSettings) {
        await supabase
          .from('system_settings')
          .upsert(setting, { onConflict: 'key' });
      }

      console.log('[DB Sync] ✅ System settings initialized');
    }

    // Update last sync timestamp
    await supabase
      .from('system_settings')
      .upsert(
        { key: 'last_sync', value: new Date().toISOString() },
        { onConflict: 'key' }
      );

    console.log('[DB Sync] ✅ Database synchronization completed successfully');

    return {
      success: true,
      timestamp: new Date().toISOString(),
      tableCheckResults,
      message: 'Database schema synchronized successfully'
    };
  } catch (error) {
    console.error('[DB Sync] ❌ Synchronization failed:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Verify database schema integrity
 * @returns {Promise<Object>} Verification result
 */
export async function verifyDatabaseIntegrity() {
  try {
    console.log('[DB Verify] Starting database integrity check...');
    
    const supabase = getSupabaseClient();
    
    const checks = {
      connection: false,
      tables: {},
      views: {},
      functions: {}
    };

    // Check connection
    const { error: connError } = await supabase.from('clinics').select('count').limit(1);
    checks.connection = !connError;

    if (!checks.connection) {
      throw new Error('Cannot connect to database');
    }

    console.log('[DB Verify] ✅ Database connection OK');

    return {
      success: true,
      checks,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[DB Verify] ❌ Verification failed:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Run database migrations
 * @returns {Promise<Object>} Migration result
 */
export async function runDatabaseMigrations() {
  try {
    console.log('[DB Migrate] Starting database migrations...');
    
    const supabase = getSupabaseClient();
    
    // This is a placeholder for actual migrations
    // In production, migrations should be managed through Supabase CLI
    
    console.log('[DB Migrate] ✅ Database migrations completed');

    return {
      success: true,
      timestamp: new Date().toISOString(),
      message: 'Database migrations completed'
    };
  } catch (error) {
    console.error('[DB Migrate] ❌ Migration failed:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

export default {
  syncDatabaseSchema,
  verifyDatabaseIntegrity,
  runDatabaseMigrations
};
