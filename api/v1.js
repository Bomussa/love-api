import apiHandler from '../lib/api-handlers.js';

const ADMIN_LOGIN_URL   = 'https://rujwuruuosffcxazymit.supabase.co/functions/v1/admin-login';
const PATIENT_LOGIN_URL = 'https://rujwuruuosffcxazymit.supabase.co/functions/v1/patient-login';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Version, X-Request-Id');
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function proxyTo(url, req, res) {
  const body = await readBody(req);
  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
  res.send(text);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url  = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (req.method === 'POST') {
    if (path === '/api/v1/admin/login' || path === '/api/v1/doctor/login') {
      return proxyTo(ADMIN_LOGIN_URL, req, res);
    }
    if (path === '/api/v1/patient/login' || path === '/api/v1/patients/login') {
      return proxyTo(PATIENT_LOGIN_URL, req, res);
    }
  }

  return apiHandler(req, res);
}
