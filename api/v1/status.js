/**
 * v1 Status Endpoint
 * Used by maintenance checks to determine the API health state.
 */
import { resolveCorsHeaders } from '../../lib/cors-policy.js';

export default async function handler(req, res) {
  const corsHeaders = resolveCorsHeaders({ origin: req.headers.origin, category: 'status' });
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
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
