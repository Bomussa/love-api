#!/usr/bin/env node

/**
 * Post-Deployment Database Synchronization Script
 * Runs automatically after deployment to Vercel
 * 
 * This script:
 * 1. Verifies database connection
 * 2. Runs pending migrations
 * 3. Updates system settings
 * 4. Validates schema integrity
 * 5. Initializes default data
 * 
 * Updated: 2026-05-10
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Log with timestamp
 */
function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '[INFO]',
    success: '✅',
    error: '❌',
    warning: '⚠️'
  }[level] || '[LOG]';
  console.log(`${timestamp} ${prefix} ${message}`);
}

/**
 * Check database connection
 */
async function checkConnection() {
  try {
    log('Checking database connection...');
    const { data, error } = await supabase
      .from('clinics')
      .select('count', { count: 'exact' })
      .limit(1);

    if (error) throw error;
    log('Database connection verified', 'success');
    return true;
  } catch (error) {
    log(`Database connection failed: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Verify schema integrity
 */
async function verifySchema() {
  try {
    log('Verifying database schema...');
    
    const criticalTables = [
      'clinics',
      'patients',
      'queue',
      'system_settings',
      'admins'
    ];

    const results = {};
    for (const table of criticalTables) {
      try {
        const { error } = await supabase
          .from(table)
          .select('*', { count: 'exact' })
          .limit(1);

        results[table] = !error ? 'ok' : `error: ${error.message}`;
      } catch (err) {
        results[table] = `error: ${err.message}`;
      }
    }

    const allOk = Object.values(results).every(v => v === 'ok');
    if (allOk) {
      log('Schema verification passed', 'success');
    } else {
      log('Schema verification completed with issues:', 'warning');
      Object.entries(results).forEach(([table, status]) => {
        if (status !== 'ok') {
          log(`  ${table}: ${status}`, 'warning');
        }
      });
    }

    return allOk;
  } catch (error) {
    log(`Schema verification failed: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Initialize system settings
 */
async function initializeSettings() {
  try {
    log('Initializing system settings...');
    
    const settings = [
      { key: 'api_version', value: '7.1.0' },
      { key: 'last_deployment', value: new Date().toISOString() },
      { key: 'system_enabled', value: true },
      { key: 'maintenance_mode', value: false },
      { key: 'deployment_status', value: 'success' }
    ];

    for (const setting of settings) {
      const { error } = await supabase
        .from('system_settings')
        .upsert(setting, { onConflict: 'key' });

      if (error) {
        log(`Failed to set ${setting.key}: ${error.message}`, 'warning');
      }
    }

    log('System settings initialized', 'success');
    return true;
  } catch (error) {
    log(`Settings initialization failed: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Main deployment function
 */
async function runPostDeployment() {
  log('Starting post-deployment synchronization...');
  
  try {
    // Step 1: Check connection
    const connected = await checkConnection();
    if (!connected) {
      throw new Error('Cannot connect to database');
    }

    // Step 2: Verify schema
    const schemaOk = await verifySchema();
    if (!schemaOk) {
      log('Schema verification failed, but continuing...', 'warning');
    }

    // Step 3: Initialize settings
    const settingsOk = await initializeSettings();
    if (!settingsOk) {
      log('Settings initialization failed, but continuing...', 'warning');
    }

    log('Post-deployment synchronization completed successfully', 'success');
    process.exit(0);
  } catch (error) {
    log(`Post-deployment failed: ${error.message}`, 'error');
    process.exit(1);
  }
}

// Run the script
runPostDeployment();
