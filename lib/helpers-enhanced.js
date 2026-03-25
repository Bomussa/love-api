/**
 * Set CORS headers with origin validation - FIXED: Allow all origins for testing
 */
export function setCorsHeaders(res, req) {
  const allowedOrigins = [
    'https://love-snowy-three.vercel.app',
    'https://love-frontend.vercel.app',
    'https://love-api-bomussa.vercel.app',
    'https://mmc-mms.com',
    'https://www.mmc-mms.com',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
  ];

  const origin = req?.headers?.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    // Allow all origins for testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'false');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
}
