import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://rujwuruuosffcxazymit.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTM4NzI2NSwiZXhwIjoyMDc2OTYzMjY1fQ.5PWwdcBXgS1FZhwRonSRgdbnUQuXHl5VeIHvr41yUbs');

async function createTable() {
  const { data, error } = await supabase.rpc('exec_sql', {
    sql_query: `
      CREATE TABLE IF NOT EXISTS qa_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status TEXT NOT NULL DEFAULT 'completed',
        ok BOOLEAN NOT NULL DEFAULT true,
        stats JSONB DEFAULT '{\"clinics_checked\": 8, \"total_findings\": 0}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `
  });

  if (error) {
    console.error('Error creating table:', error);
  } else {
    console.log('Table created successfully:', data);
  }
}

createTable();
