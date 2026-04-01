/**
 * V1 API Handler - Doctor-Controlled Queue System (No PIN)
 * @version 4.0.0
 */

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { url, method } = req;
  const pathname = url.split('?')[0];

  // Health check
  if (pathname === '/api/v1/health' || pathname === '/api/health') {
    return res.status(200).json({
      status: 'ok',
      version: '4.0.0-doctor-controlled',
      features: {
        pinSystem: false,
        doctorControl: true
      },
      timestamp: new Date().toISOString()
    });
  }

  // Status endpoint
  if (pathname === '/api/v1/status') {
    return res.status(200).json({
      status: 'healthy',
      mode: 'online',
      backend: 'up',
      platform: 'vercel',
      version: '4.0.0-no-pin',
      features: {
        pinSystem: false,
        doctorControl: true,
        dynamicRouting: true
      },
      timestamp: new Date().toISOString()
    });
  }

  // Block PIN requests
  if (pathname.includes('pin')) {
    return res.status(410).json({
      success: false,
      error: 'PIN_REMOVED',
      message: 'PIN system has been removed. Use the new doctor-controlled queue system.',
      timestamp: new Date().toISOString()
    });
  }

  // Default response
  return res.status(200).json({
    status: 'ok',
    message: 'API v1 is running',
    path: pathname,
    method: method,
    timestamp: new Date().toISOString()
  });
}
