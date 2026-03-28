/**
 * Shared HTTP/API helpers used by v1 routes and legacy delegated handlers.
 */

const rateLimitStore = new Map();

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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'false');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token, X-Admin-Secret');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { return {}; }
}

export function getClientIP(req) {
  return req.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers?.['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}

export function checkRateLimit(clientId, maxRequests = 100, windowMs = 60_000) {
  const now = Date.now();
  const key = String(clientId || 'unknown');
  const current = rateLimitStore.get(key);

  if (!current || now > current.resetAt) {
    const next = { count: 1, resetAt: now + windowMs };
    rateLimitStore.set(key, next);
    return { allowed: true, remaining: maxRequests - 1, resetAt: next.resetAt };
  }

  if (current.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  }

  current.count += 1;
  rateLimitStore.set(key, current);
  return { allowed: true, remaining: Math.max(0, maxRequests - current.count), resetAt: current.resetAt };
}

export function validateClinicId(clinicId) {
  const value = String(clinicId ?? '').trim();
  return value.length > 0 && value.length <= 64;
}

export function formatError(message, code = 'ERROR', details = null) {
  return { success: false, error: code, message, ...(details !== null ? { details } : {}) };
}

export function formatSuccess(data = null, message = 'OK') {
  return { success: true, message, ...(data !== null ? { data } : {}) };
}

export function logRequest(req, meta = {}) {
  if (process.env.NODE_ENV === 'test') return;
  const method = req?.method || '-';
  const url = req?.url || '-';
  console.log('[api]', method, url, meta);
}

export function handleError(res, error, fallbackMessage = 'INTERNAL_SERVER_ERROR') {
  const message = error?.message || fallbackMessage;
  return res.status(500).json(formatError(message, 'INTERNAL_SERVER_ERROR'));
}
