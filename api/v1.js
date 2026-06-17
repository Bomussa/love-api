import apiHandler from '../lib/api-handlers.js';

const ADMIN_EF   = 'https://rujwuruuosffcxazymit.supabase.co/functions/v1/admin-login';
const PATIENT_EF = 'https://rujwuruuosffcxazymit.supabase.co/functions/v1/patient-login';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Version, X-Request-Id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  let raw = ''; for await (const c of req) raw += c;
  try { return JSON.parse(raw); } catch { return {}; }
}

async function proxyTo(efUrl, req, res) {
  const body = await readBody(req);
  const up = await fetch(efUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await up.text();
  setCors(res);
  res.status(up.status);
  res.setHeader('Content-Type', up.headers.get('content-type') || 'application/json');
  res.send(text);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // استخراج الـ path الحقيقي
  // Vercel يُعيد كتابة /api/v1/foo → /api/v1.js?path=foo
  // لكن req.url قد يكون /api/v1.js?path=admin/login
  // أو قد يكون /api/v1/admin/login (إذا Vercel حافظ على الـ URL)
  const rawUrl = req.url || '/';
  const host = req.headers.host || 'localhost';
  const parsed = new URL(rawUrl, `https://${host}`);
  
  let pathname = parsed.pathname;
  
  // إذا Vercel أعاد كتابة الـ URL لـ /api/v1.js، نقرأ path من query
  if (pathname === '/api/v1.js' || pathname.endsWith('/api/v1.js')) {
    const pathParam = parsed.searchParams.get('path') || '';
    pathname = `/api/v1/${pathParam}`;
  }

  const method = req.method?.toUpperCase() || 'GET';

  // Admin + Doctor login → edge function
  if (method === 'POST' && (
    pathname === '/api/v1/admin/login' ||
    pathname === '/api/v1/doctor/login'
  )) {
    return proxyTo(ADMIN_EF, req, res);
  }

  // Patient login → edge function
  if (method === 'POST' && (
    pathname === '/api/v1/patient/login' ||
    pathname === '/api/v1/patients/login'
  )) {
    return proxyTo(PATIENT_EF, req, res);
  }

  // باقي المسارات → apiHandler الأصلي مع تصحيح req.url
  req.url = `https://${host}${pathname}${parsed.search}`;
  return apiHandler(req, res);
}
