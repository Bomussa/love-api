#!/usr/bin/env node
/**
 * Inspect live Supabase database schema and data
 * Usage: node scripts/inspect-supabase-live.js
 * Output: Complete database structure for audit and sync
 */

import { createClient } from '@supabase/supabase-js';

const PROJECT_URL = 'https://rujwuruuosffcxazymit.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEzODcyNjUsImV4cCI6MjA3Njk2MzI2NX0.HnrSwc7OZTqYRzCwzBH8hqtgtHMBix4yxy0RKvRDX10';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTM4NzI2NSwiZXhwIjoyMDc2OTYzMjY1fQ.5PWwdcBXgS1FZhwRonSRgdbnUQuXHl5VeIHvr41yUbs';

const supabase = createClient(PROJECT_URL, SERVICE_KEY);

const CORE_TABLES = [
  'patients',
  'doctors', 
  'clinics',
  'queue',
  'admins',
  'routes',
  'notifications'
];

async function getTableSchema(tableName) {
  try {
    const { data: columns, error } = await supabase
      .rpc('get_table_columns', { table_name: tableName });
    
    if (error && error.code !== 'PGRST116') {
      console.error(`❌ Error fetching schema for ${tableName}:`, error);
      return null;
    }
    return columns || [];
  } catch (e) {
    console.warn(`⚠️  Fallback: Using direct query for ${tableName}`);
    return null;
  }
}

async function getTableData(tableName) {
  try {
    const { data, error, count } = await supabase
      .from(tableName)
      .select('*', { count: 'exact' })
      .limit(10);
    
    if (error) {
      if (error.code === 'PGRST116') {
        return { rows: 0, sample: [] };
      }
      console.error(`❌ Error fetching data from ${tableName}:`, error);
      return null;
    }
    return { rows: count, sample: data || [] };
  } catch (e) {
    console.error(`❌ Exception fetching ${tableName}:`, e.message);
    return null;
  }
}

async function inspectDatabase() {
  console.log('\n📊 === SUPABASE LIVE DATABASE INSPECTION ===');
  console.log(`Project: ${PROJECT_URL}`);
  console.log(`\n🔍 Scanning ${CORE_TABLES.length} core tables...\n`);

  const report = {};

  for (const table of CORE_TABLES) {
    console.log(`📋 Table: ${table.toUpperCase()}`);
    
    const dataInfo = await getTableData(table);
    if (!dataInfo) {
      console.log(`   ⚠️  Table not accessible\n`);
      continue;
    }

    report[table] = dataInfo;
    console.log(`   ✅ Rows: ${dataInfo.rows}`);
    
    if (dataInfo.sample.length > 0) {
      console.log(`   📝 Sample record: ${JSON.stringify(dataInfo.sample[0], null, 2)}`);
    }
    console.log('');
  }

  console.log('\n✅ === INSPECTION COMPLETE ===');
  console.log(JSON.stringify(report, null, 2));
  
  return report;
}

inspectDatabase().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
