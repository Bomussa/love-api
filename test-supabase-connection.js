import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTM4NzI2NSwiZXhwIjoyMDc2OTYzMjY1fQ.5PWwdcBXgS1FZhwRonSRgdbnUQuXHl5VeIHvr41yUbs';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runTest() {
  console.log('--- Testing Supabase Connection ---');
  
  try {
    // 1. Test basic connection by listing tables (indirectly via a common table)
    const { data: clinics, error: clinicsError } = await supabase.from('clinics').select('id, name_ar').limit(1);
    if (clinicsError) {
      console.error('Error fetching clinics:', clinicsError.message);
    } else {
      console.log('Successfully fetched clinics:', clinics);
    }

    // 2. Test qa_runs table (used in v1.js)
    const { data: qaRuns, error: qaError } = await supabase.from('qa_runs').select('*').limit(1);
    if (qaError) {
      console.error('Error fetching qa_runs:', qaError.message);
      if (qaError.code === '42P01') {
        console.log('Table qa_runs does not exist. We may need to create it.');
      }
    } else {
      console.log('Successfully fetched qa_runs:', qaRuns);
    }

    // 3. Check for other required tables
    const tables = ['qa_findings', 'repair_runs', 'system_config', 'device_logins', 'daily_activity_logs'];
    for (const table of tables) {
      const { error } = await supabase.from(table).select('id').limit(1);
      if (error) {
        console.log(`Table ${table}: NOT FOUND or ERROR (${error.message})`);
      } else {
        console.log(`Table ${table}: OK`);
      }
    }

  } catch (err) {
    console.error('Unexpected error during test:', err);
  }
}

runTest();
