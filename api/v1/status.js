/**
 * v1 Status Endpoint
 * Used by maintenance checks to determine the API health state.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, x-client-info');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('X-API-Version', '5.0.0');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    platform: 'vercel',
    environment: process.env.NODE_ENV || 'production',
    checks: {
      api: 'healthy',
    },
  });
}
