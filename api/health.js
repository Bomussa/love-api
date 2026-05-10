/**
 * Health Check Endpoint
 * Simple health check for Vercel deployment
 */

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  return res.status(200).json({
    success: true,
    status: 'online',
    timestamp: new Date().toISOString(),
    version: '7.1.0'
  });
}
