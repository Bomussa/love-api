import apiHandler from '../lib/api-handlers.js';
import sessionHandler from '../lib/session-handlers.js';

const ADMIN_EF   = 'https://rujwuruuosffcxazymit.supabase.co/functions/v1/admin-login';
const PATIENT_EF = 'https://rujwuruuosffcxazymit.supabase.co/functions/v1/patient-login';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Version');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

async function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  let raw = ''; for await (const c of req) raw += c;
  try { return JSON.parse(raw); } catch { return {}; }
}

async function proxy(url, req, res) {
  const b = await body(req);
  const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) });
  const t = await r.text();
  cors(res); res.status(r.status);
  res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
  res.send(t);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const host = req.headers.host || 'localhost';
  const rawUrl = req.url || '/';
  const parsed = new URL(rawUrl, `https://${host}`);
  let pathname = parsed.pathname;

  // Vercel rewrite: /api/v1/foo/bar → /api/v1.js?path=foo/bar
  if (pathname === '/api/v1.js' || pathname.endsWith('/v1.js')) {
    const p = parsed.searchParams.get('path') || '';
    pathname = `/api/v1/${p}`;
  }

  const method = req.method?.toUpperCase() || 'GET';

  // DEBUG
  if (pathname.includes('/debug')) {
    return res.status(200).json({ rawUrl, pathname, method, host });
  }

  // Session endpoints
  if (pathname.startsWith('/api/v1/session/')) {
    return sessionHandler(req, res);
  }

  // Admin + Doctor login
  if (method === 'POST' && (pathname === '/api/v1/admin/login' || pathname === '/api/v1/doctor/login')) {
    return proxy(ADMIN_EF, req, res);
  }

  // Patient login
  if (method === 'POST' && (pathname === '/api/v1/patient/login' || pathname === '/api/v1/patients/login')) {
    return proxy(PATIENT_EF, req, res);
  }

  // Everything else → original handler with corrected URL
  req.url = `https://${host}${pathname}${parsed.search.replace(/[?&]path=[^&]*/,'')}`;
  return apiHandler(req, res);
}
