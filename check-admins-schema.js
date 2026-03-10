import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://rujwuruuosffcxazymit.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTM4NzI2NSwiZXhwIjoyMDc2OTYzMjY1fQ.5PWwdcBXgS1FZhwRonSRgdbnUQuXHl5VeIHvr41yUbs'
);

async function checkAdminsSchema() {
  console.log('=== Checking Admins Table Schema ===\n');

  try {
    // Get one admin record to see what columns exist
    const { data: admin } = await supabase
      .from('admins')
      .select('*')
      .limit(1)
      .single();

    if (admin) {
      console.log('✅ Admin record found:');
      console.log(JSON.stringify(admin, null, 2));
      
      console.log('\n📊 Available columns:');
      Object.keys(admin).forEach(key => {
        console.log(`   - ${key}: ${typeof admin[key]}`);
      });
    } else {
      console.log('⚠️  No admin records found');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkAdminsSchema();
