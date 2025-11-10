// Debug API endpoint to check environment variables
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Debug environment variables (safe check)
  const envCheck = {
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseAnonKey: !!process.env.SUPABASE_ANON_KEY,
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    // Show partial values for debugging (first 10 chars)
    supabaseUrlPrefix: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 20) + '...' : 'NOT_SET',
    nodeEnv: process.env.NODE_ENV || 'NOT_SET',
    vercelEnv: process.env.VERCEL_ENV || 'NOT_SET'
  };

  return res.status(200).json({
    success: true,
    status: 'debug',
    timestamp: new Date().toISOString(),
    environment: envCheck,
    message: 'Debug endpoint - checking environment variables'
  });
}