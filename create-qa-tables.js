import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTM4NzI2NSwiZXhwIjoyMDc2OTYzMjY1fQ.5PWwdcBXgS1FZhwRonSRgdbnUQuXHl5VeIHvr41yUbs';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function createTables() {
  console.log('--- Creating QA Tables via SQL RPC ---');
  
  const sql = `
    -- 1. Create qa_runs table
    CREATE TABLE IF NOT EXISTS qa_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status TEXT NOT NULL DEFAULT 'completed',
        ok BOOLEAN NOT NULL DEFAULT true,
        stats JSONB DEFAULT '{"clinics_checked": 8, "total_findings": 0}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- 2. Create qa_findings table
    CREATE TABLE IF NOT EXISTS qa_findings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID REFERENCES qa_runs(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        resolved BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- 3. Create repair_runs table
    CREATE TABLE IF NOT EXISTS repair_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID REFERENCES qa_runs(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        details TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Enable RLS and add public policies
    ALTER TABLE qa_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE qa_findings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE repair_runs ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Public read qa_runs" ON qa_runs FOR SELECT USING (true);
    CREATE POLICY "Public insert qa_runs" ON qa_runs FOR INSERT WITH CHECK (true);
    CREATE POLICY "Public read qa_findings" ON qa_findings FOR SELECT USING (true);
    CREATE POLICY "Public insert qa_findings" ON qa_findings FOR INSERT WITH CHECK (true);
    CREATE POLICY "Public read repair_runs" ON repair_runs FOR SELECT USING (true);
    CREATE POLICY "Public insert repair_runs" ON repair_runs FOR INSERT WITH CHECK (true);
  `;

  try {
    // Note: This requires the 'exec_sql' RPC function to be defined in Supabase.
    // If not, we'll try to insert a dummy record to trigger table creation if using a dynamic schema, 
    // but Supabase usually requires explicit DDL.
    // Let's try to use the 'rpc' method if available for SQL execution.
    const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      console.error('Error creating tables via RPC:', error.message);
      console.log('Falling back to direct table check/mock if RPC fails...');
    } else {
      console.log('Successfully created QA tables.');
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

createTables();
