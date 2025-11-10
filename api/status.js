// Status endpoint for API health check
export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        return res.status(200).json({
            success: true,
            status: 'healthy',
            mode: 'online',
            backend: 'up',
            platform: 'vercel',
            timestamp: new Date().toISOString(),
            version: '2.0.0',
            environment: {
                hasSupabaseUrl: !!process.env.SUPABASE_URL,
                hasSupabaseAnonKey: !!process.env.SUPABASE_ANON_KEY,
                hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
                nodeEnv: process.env.NODE_ENV || 'development',
                vercelEnv: process.env.VERCEL_ENV || 'development'
            }
        });
    }

    return res.status(405).json({
        success: false,
        error: 'Method not allowed'
    });
}