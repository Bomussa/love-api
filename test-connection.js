const SUPABASE_URL = 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTM4NzI2NSwiZXhwIjoyMDc2OTYzMjY1fQ.5PWwdcBXgS1FZhwRonSRgdbnUQuXHl5VeIHvr41yUbs';

async function test() {
  console.log('Testing connection to Supabase...');
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/settings?limit=1`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Connection Successful!');
      console.log('Sample Data:', data);
    } else {
      console.error('❌ Connection Failed:', response.status, response.statusText);
      const err = await response.text();
      console.error('Error Details:', err);
    }
  } catch (error) {
    console.error('❌ Error during test:', error.message);
  }
}

test();
