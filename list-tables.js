import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTM4NzI2NSwiZXhwIjoyMDc2OTYzMjY1fQ.5PWwdcBXgS1FZhwRonSRgdbnUQuXHl5VeIHvr41yUbs';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function listTables() {
  console.log('--- Listing All Tables via RPC/SQL ---');
  
  try {
    // Try to get tables using information_schema via a raw query if possible, 
    // or just check common names
    const commonTables = [
      'clinics', 'patients', 'visits', 'appointments', 
      'qa_runs', 'qa_findings', 'repair_runs', 
      'system_config', 'device_logins', 'daily_activity_logs',
      'users', 'admins', 'settings', 'logs'
    ];
    
    for (const table of commonTables) {
      const { data, error, count } = await supabase.from(table).select('*', { count: 'exact', head: true });
      if (!error) {
        console.log(`Table: ${table} (Count: ${count})`);
      }
    }

  } catch (err) {
    console.error('Error:', err);
  }
}

listTables();
