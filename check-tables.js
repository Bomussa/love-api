import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://rujwuruuosffcxazymit.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTM4NzI2NSwiZXhwIjoyMDc2OTYzMjY1fQ.5PWwdcBXgS1FZhwRonSRgdbnUQuXHl5VeIHvr41yUbs');

async function check() {
  const { data: tables, error } = await supabase.rpc('exec_sql', {
    sql_query: "SELECT 1 as success"
  });
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('Tables:', tables);
  
  const tableNames = Array.isArray(tables) ? tables.map(t => t.table_name) : [];
  const targetTables = ['smart_errors_log', 'smart_fixes_log', 'qa_runs', 'qa_findings', 'repair_runs'];
  targetTables.forEach(t => {
    console.log(`${t}: ${tableNames.includes(t) ? 'EXISTS' : 'MISSING'}`);
  });
}

check();
