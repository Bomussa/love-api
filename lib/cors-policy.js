export const ALLOWED_CORS_ORIGINS = [
  'https://love-snowy-three.vercel.app',
  'https://mmc-mms.com',
  'https://www.mmc-mms.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

export const CORS_ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
export const CORS_ALLOW_HEADERS = 'Content-Type, Authorization, X-Session-Token';

export function isAllowedCorsOrigin(origin) {
  return Boolean(origin && ALLOWED_CORS_ORIGINS.includes(origin));
}

export function applyCorsPolicy(req, res) {
  const origin = req?.headers?.origin;

  res.setHeader('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
  res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (!origin) {
    return { allowed: true, origin: null };
  }

  if (isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    return { allowed: true, origin };
  }

  return { allowed: false, origin };
}
