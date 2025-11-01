import { supabaseQuery } from './api/supabase-client.js';

// Set environment variable
process.env.VITE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEzODcyNjUsImV4cCI6MjA3Njk2MzI2NX0.HnrSwc7OZTqZRzCwzBH8hqtgtHMBix4yxy0RKvRDX10';

async function test() {
  try {
    console.log('Testing Supabase connection...');
    
    const clinics = await supabaseQuery('clinics', {
      filter: { is_active: true }
    });
    
    console.log(`✅ Found ${clinics.length} active clinics`);
    console.log(clinics.map(c => c.name_ar).join(', '));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

test();
