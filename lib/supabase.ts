import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getEnv, validateStartupEnv } from './env.js';

validateStartupEnv([
  { key: 'SUPABASE_URL' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', aliases: ['SUPABASE_KEY'] },
]);

const supabaseUrl = getEnv('SUPABASE_URL', { required: true, context: 'Supabase Edge client' });
const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', { required: true, aliases: ['SUPABASE_KEY'], context: 'Supabase Edge privileged client' });

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Helper function to verify connection
export async function verifySupabaseConnection() {
  try {
    const { data, error } = await supabase.from('clinics').select('id').limit(1);
    if (error) throw error;
    return { connected: true, message: 'Supabase connection verified' };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

// Helper function for safe RPC calls
export async function callRPC(functionName: string, params: Record<string, any>) {
  try {
    const { data, error } = await supabase.rpc(functionName, params);
    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
