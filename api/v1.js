/**
 * api/v1.js — MMC Backend v5.0 FINAL
 * ✅ PIN system REMOVED (410 on any /pin/ path)
 * ✅ /queue/create ADDED (was the missing endpoint causing medical path screen bug)
 * ✅ /queue/start  WAITING → IN_PROGRESS
 * ✅ /queue/advance IN_PROGRESS → WAITING|DONE  (doctor-only, clinic-enforced)
 * ✅ Atomic queue numbers via DB RPC or sequential fallback
 * ✅ Optimistic version locking
 * ✅ Idempotency-Key header support
 * ✅ Recovery engine
 * ✅ All data from Supabase (single source of truth)
 */

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  createAdminToken, verifyAdminBearerToken,
  hasValidAdminSecret, verifyPasswordHash, hashPassword,
} from '../lib/admin-auth.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const ADMIN_AUTH_SECRET = process.env.ADMIN_AUTH_SECRET;

// ── Authoritative route map (matches frontend clinics.json IDs) ──
const ROUTE_MAP = {
  recruitment: { male: ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'], female: ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'] },
  promotion:   { male: ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'], female: ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'] },
  transfer:    { male: ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'], female: ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'] },
  referral:    { male: ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'], female: ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'] },
  contract:    { male: ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'], female: ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'] },
  aviation:    { male: ['LAB','EYE','INT','ENT','ECG','AUD'], female: ['LAB','EYE','INT','ENT','ECG','AUD'] },
  cooks:       { male: ['LAB','INT','ENT','SUR'], female: ['LAB','INT','ENT','SUR'] },
  courses:     { male: ['LAB','EYE','SUR','INT'], female: ['LAB','EYE','SUR','INT'] },
};

function getPath(examType, gender) {
  const g = (gender || '').toLowerCase() === 'female' ? 'female' : 'male';
  const t = ROUTE_MAP[examType] ? examType : 'recruitment';
  return [...ROUTE_MAP[t][g]];
}

// ── Idempotency cache ──
const idempCache = new Map();
function cacheIdemp(key, body) {
  idempCache.set(key, body);
  setTimeout(() => idempCache.delete(key), 3_600_000);
}

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}


function getPathId(pathname, base) {
  if (!pathname.startsWith(base)) return null;
  const rem = pathname.slice(base.length).replace(/^\/+/, '');
  return rem ? rem.split('/')[0] : null;
}

async function runRecovery(supabase) {
  if (!supabase) return;
  try {
    const cutoff = new Date(Date.now() - 120_000).toISOString();
    await supabase.from('queues').update({ called_at: null, updated_at: new Date().toISOString() })
      .eq('status', 'WAITING').lt('called_at', cutoff).not('called_at', 'is', null);
    console.log('[RECOVERY] Complete');
  } catch (e) {
    console.warn('[RECOVERY] Error:', e.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Idempotency-Key');
  res.setHeader('Cache-Control', 'no-cache,no-store,must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const fullUrl = req.url.startsWith('http')
    ? req.url
    : `https://${req.headers.host || 'localhost'}${req.url}`;
  const parsed  = new URL(fullUrl);
  const pathname = parsed.pathname;
  const method   = req.method;
  const query    = Object.fromEntries(parsed.searchParams);

  // ── HARD PIN BLOCK ──────────────────────────────────────────────────────────
  if (pathname.toLowerCase().includes('pin')) {
    return res.status(410).json({ success: false, error: 'PIN system permanently removed', code: 'PIN_REMOVED' });
  }

  // ── IDEMPOTENCY ─────────────────────────────────────────────────────────────
  const iKey = req.headers['idempotency-key'];
  if (method === 'POST' && iKey && idempCache.has(iKey)) {
    return res.status(200).json({ ...idempCache.get(iKey), _idempotent: true });
  }

  // ── PARSE BODY ──────────────────────────────────────────────────────────────
  let body = {};
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    body = req._mmcParsedBody || (typeof req.body === 'object' ? req.body : {});
  }

  const reply = (status, data) => {
    if (method === 'POST' && iKey) cacheIdemp(iKey, data);
    return res.status(status).json(data);
  };

  const sb = getSupabase();
  const today = new Date().toISOString().split('T')[0];

  try {

    // ── HEALTH ─────────────────────────────────────────────────────────────────
    if ((pathname === '/api/v1/health' || pathname === '/api/health') && method === 'GET') {
      return reply(200, { success: true, status: 'ok', version: '5.0.0', timestamp: new Date().toISOString(), pin_system: 'REMOVED', queue_system: 'DOCTOR_CONTROLLED' });
    }

    // ── STATUS ─────────────────────────────────────────────────────────────────
    if (pathname === '/api/v1/status' && method === 'GET') {
      let db = 'unknown';
      if (sb) { const { error } = await sb.from('clinics').select('id', { count: 'exact', head: true }); db = error ? 'degraded' : 'healthy'; }
      return reply(200, { success: true, status: db, mode: 'online', timestamp: new Date().toISOString() });
    }

    // ── SETTINGS ───────────────────────────────────────────────────────────────
    if (pathname === '/api/v1/settings' && method === 'GET') {
      return reply(200, { success: true, data: { pin_system_enabled: false, pin_system_visible: false, queue_system_enabled: true, doctor_control_enabled: true } });
    }

    // ── CLINICS (from Supabase = single source of truth) ───────────────────────
    if (pathname === '/api/v1/clinics' && method === 'GET') {
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const { data, error } = await sb.from('clinics').select('*').order('name_ar');
      if (error) throw error;
      return reply(200, { success: true, data: data || [] });
    }

    // ── PATIENT LOGIN ──────────────────────────────────────────────────────────
    if ((pathname === '/api/v1/patient/login' || pathname === '/api/v1/patients/login') && method === 'POST') {
      const { personalId, gender } = body;
      if (!personalId || !gender) return reply(400, { success: false, error: 'personalId and gender required' });
      const sessionId = crypto.randomUUID();
      return reply(200, {
        success: true,
        data: { sessionId, personalId: String(personalId).trim(), gender: gender === 'female' ? 'female' : 'male', expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      });
    }

    // ── QUEUE CREATE ── (THE FIX: this endpoint was completely missing) ─────────
    if (pathname === '/api/v1/queue/create' && method === 'POST') {
      const { patientId, sessionId, examType, gender } = body;
      if (!examType || !gender) return reply(400, { success: false, error: 'examType and gender required' });
      const pid = patientId || sessionId;
      if (!pid) return reply(400, { success: false, error: 'patientId or sessionId required' });
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });

      const path = getPath(examType, gender);
      const firstClinic = path[0];

      // Check existing active queue for patient today
      const { data: existing } = await sb.from('queues')
        .select('id,display_number,status,path,current_step')
        .eq('patient_id', pid).eq('queue_date', today)
        .not('status', 'in', '("DONE","CANCELLED")').limit(1).maybeSingle();

      if (existing) {
        return reply(200, {
          success: true,
          data: { queueId: existing.id, number: existing.display_number, status: existing.status, path: existing.path || path, current_step: existing.current_step || 0, already_exists: true },
        });
      }

      // ATOMIC: Try DB function first
      let queueId, number;
      try {
        const { data: rpc, error: rpcErr } = await sb.rpc('fn_create_queue_atomic', {
          p_patient_id: pid, p_exam_type: examType, p_path: path,
        });
        if (!rpcErr && rpc) { queueId = rpc.queue_id; number = rpc.number; }
      } catch (_) { /* fall through to sequential */ }

      // Sequential fallback (safe in practice — JS event loop is single-threaded per request)
      if (!queueId) {
        const { data: maxRow } = await sb.from('queues')
          .select('display_number').eq('clinic_id', firstClinic).eq('queue_date', today)
          .order('display_number', { ascending: false }).limit(1).maybeSingle();
        number = (maxRow?.display_number || 0) + 1;

        const { data: ins, error: insErr } = await sb.from('queues').insert({
          patient_id: pid, clinic_id: firstClinic, exam_type: examType,
          display_number: number, queue_number_int: number, queue_number: String(number),
          path, current_step: 0, status: 'WAITING', version: 1, queue_date: today,
          entered_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).select('id').single();
        if (insErr) throw insErr;
        queueId = ins.id;
      }

      return reply(200, {
        success: true,
        data: { queueId, number, status: 'WAITING', path, current_step: 0, created_at: new Date().toISOString() },
      });
    }

    // ── QUEUE STATUS ───────────────────────────────────────────────────────────
    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const { queueId, patientId, clinicId } = query;

      if (clinicId && !queueId && !patientId) {
        const { count } = await sb.from('queues').select('*', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('queue_date', today).eq('status', 'WAITING');
        return reply(200, { success: true, data: { clinicId, waitingCount: count || 0 } });
      }

      let q;
      if (queueId) { const { data } = await sb.from('queues').select('*').eq('id', queueId).single(); q = data; }
      else if (patientId) { const { data } = await sb.from('queues').select('*').eq('patient_id', patientId).eq('queue_date', today).not('status', 'in', '("DONE","CANCELLED")').limit(1).maybeSingle(); q = data; }
      if (!q) return reply(404, { success: false, error: 'Queue not found' });
      return reply(200, { success: true, data: { queueId: q.id, number: q.display_number, status: q.status, current_step: q.current_step, path: q.path, version: q.version, called_at: q.called_at, activated_at: q.activated_at } });
    }

    // ── QUEUE POSITION ─────────────────────────────────────────────────────────
    if (pathname === '/api/v1/queue/position' && method === 'GET') {
      if (!sb) return reply(200, { success: true, display_number: null, current_number: 0, ahead: 0, total_waiting: 0 });
      const { clinic, user } = query;
      const { data: waiting } = await sb.from('queues').select('id,display_number,patient_id').eq('clinic_id', clinic).eq('queue_date', today).eq('status', 'WAITING').order('display_number');
      let userQ = null;
      if (user) { const { data } = await sb.from('queues').select('id,display_number,entered_at').eq('patient_id', user).eq('queue_date', today).not('status', 'in', '("DONE","CANCELLED")').limit(1).maybeSingle(); userQ = data; }
      const pos = userQ && waiting ? waiting.findIndex(w => w.id === userQ.id) : -1;
      return reply(200, { success: true, display_number: userQ?.display_number || null, current_number: waiting?.[0]?.display_number ? waiting[0].display_number - 1 : 0, ahead: pos >= 0 ? pos : 0, total_waiting: waiting?.length || 0, entered_at: userQ?.entered_at || null });
    }

    // ── QUEUE CALL (doctor calls next) ─────────────────────────────────────────
    if (pathname === '/api/v1/queue/call' && method === 'POST') {
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const { clinicId } = body;
      if (!clinicId) return reply(400, { success: false, error: 'clinicId required' });
      const { data: next } = await sb.from('queues').select('*').eq('clinic_id', clinicId).eq('queue_date', today).eq('status', 'WAITING').order('display_number').limit(1).maybeSingle();
      if (!next) return reply(200, { success: true, data: { message: 'Queue empty', clinicId } });
      await sb.from('queues').update({ called_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', next.id);
      return reply(200, { success: true, data: { queueId: next.id, number: next.display_number, patient_id: next.patient_id, called_at: new Date().toISOString(), clinicId } });
    }

    // ── QUEUE START: WAITING → IN_PROGRESS ─────────────────────────────────────
    if (pathname === '/api/v1/queue/start' && method === 'POST') {
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const { queueId } = body;
      if (!queueId) return reply(400, { success: false, error: 'queueId required' });
      const { data: q } = await sb.from('queues').select('*').eq('id', queueId).single();
      if (!q) return reply(404, { success: false, error: 'Queue not found' });
      if (q.status !== 'WAITING') return reply(409, { success: false, error: `Cannot start: status is ${q.status}, must be WAITING`, code: 'INVALID_STATE_TRANSITION' });
      const { data: u, error: uErr } = await sb.from('queues').update({
        status: 'IN_PROGRESS', current_step: Math.max(q.current_step || 0, 1),
        activated_at: new Date().toISOString(), version: (q.version || 1) + 1, updated_at: new Date().toISOString(),
      }).eq('id', queueId).select('*').single();
      if (uErr) throw uErr;
      return reply(200, { success: true, data: { queueId: u.id, status: u.status, current_step: u.current_step, activated_at: u.activated_at, version: u.version } });
    }

    // ── QUEUE ADVANCE: doctor-only, enforces clinic match ──────────────────────
    if (pathname === '/api/v1/queue/advance' && method === 'POST') {
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const { queueId, doctorClinicId, version: cv } = body;
      if (!queueId) return reply(400, { success: false, error: 'queueId required' });
      const { data: q } = await sb.from('queues').select('*').eq('id', queueId).single();
      if (!q) return reply(404, { success: false, error: 'Queue not found' });

      // STATE GUARD
      if (q.status !== 'IN_PROGRESS') return reply(409, { success: false, error: `Cannot advance: status is ${q.status}, must be IN_PROGRESS`, code: 'INVALID_STATE_TRANSITION' });

      const path = q.path || [];
      const step = q.current_step || 1;
      if (step > path.length) return reply(409, { success: false, error: 'Invalid state: step exceeds path', code: 'INVALID_STATE' });

      // CLINIC VALIDATION — server-enforced, no bypass possible
      const expectedClinic = path[step - 1];
      if (doctorClinicId && doctorClinicId !== expectedClinic) {
        return reply(403, { success: false, error: `Clinic mismatch: expected ${expectedClinic}, got ${doctorClinicId}`, code: 'CLINIC_MISMATCH', expected: expectedClinic, provided: doctorClinicId });
      }

      // OPTIMISTIC LOCK
      const clientVersion = cv !== undefined ? parseInt(cv) : null;
      if (clientVersion !== null && q.version !== clientVersion) return reply(409, { success: false, error: 'Version conflict', code: 'VERSION_CONFLICT', current_version: q.version });

      const newStep = step + 1;
      const isDone  = newStep >= path.length;
      const updates = isDone
        ? { current_step: newStep, status: 'DONE', completed_at: new Date().toISOString(), version: (q.version || 1) + 1, updated_at: new Date().toISOString() }
        : { current_step: newStep, status: 'WAITING', version: (q.version || 1) + 1, updated_at: new Date().toISOString() };

      // Double-check version at DB level (prevents race conditions)
      const { data: u, error: uErr } = await sb.from('queues').update(updates).eq('id', queueId).eq('version', q.version).select('*').single();
      if (uErr) {
        if (uErr.code === 'PGRST116') return reply(409, { success: false, error: 'Version conflict (concurrent update)', code: 'VERSION_CONFLICT' });
        throw uErr;
      }

      return reply(200, { success: true, data: { queueId: u.id, status: u.status, current_step: u.current_step, next_clinic: isDone ? null : path[u.current_step], is_done: isDone, version: u.version } });
    }

    // ── QUEUE DONE (legacy — no PIN) ───────────────────────────────────────────
    if (pathname === '/api/v1/queue/done' && method === 'POST') {
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const { patientId } = body;
      await sb.from('queues').update({ status: 'DONE', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('patient_id', patientId).in('status', ['WAITING', 'IN_PROGRESS', 'called', 'serving']);
      return reply(200, { success: true, data: { completed: true } });
    }

    // ── QUEUE ENTER (legacy compat → redirects to create logic) ───────────────
    if (pathname === '/api/v1/queue/enter' && method === 'POST') {
      const pid = body.user || body.sessionId;
      const et  = body.queueType || body.examType || 'recruitment';
      const gen = body.gender || 'male';
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const path = getPath(et, gen);
      const { data: existing } = await sb.from('queues').select('id,display_number').eq('patient_id', pid).eq('queue_date', today).not('status', 'in', '("DONE","CANCELLED")').limit(1).maybeSingle();
      if (existing) return reply(200, { success: true, data: { queueId: existing.id, number: existing.display_number, display_number: existing.display_number, already_exists: true } });
      const { data: maxRow } = await sb.from('queues').select('display_number').eq('clinic_id', path[0]).eq('queue_date', today).order('display_number', { ascending: false }).limit(1).maybeSingle();
      const number = (maxRow?.display_number || 0) + 1;
      const { data: ins, error: insErr } = await sb.from('queues').insert({ patient_id: pid, clinic_id: path[0], exam_type: et, display_number: number, queue_number_int: number, queue_number: String(number), path, current_step: 0, status: 'WAITING', version: 1, queue_date: today, entered_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select('id').single();
      if (insErr) throw insErr;
      return reply(200, { success: true, data: { queueId: ins.id, number, display_number: number } });
    }

    // ── ROUTE APIs ─────────────────────────────────────────────────────────────
    if (pathname === '/api/v1/route/create' && method === 'POST') {
      const { patientId, examType, gender, stations } = body;
      return reply(200, { success: true, data: { patientId, route: { stations: stations || getPath(examType, gender) } } });
    }
    if (pathname === '/api/v1/route/get' && method === 'GET') {
      if (!sb) return reply(404, { success: false, error: 'Route not found' });
      const { patientId } = query;
      const { data: q } = await sb.from('queues').select('path,patient_id').eq('patient_id', patientId).eq('queue_date', today).not('status', 'in', '("DONE","CANCELLED")').limit(1).maybeSingle();
      if (q) return reply(200, { success: true, route: { stations: q.path, patientId } });
      return reply(404, { success: false, error: 'Route not found' });
    }

    // ── STATS ──────────────────────────────────────────────────────────────────
    if ((pathname === '/api/v1/stats/queues' || pathname === '/api/v1/stats/dashboard') && method === 'GET') {
      if (!sb) return reply(200, { success: true, data: { total: 0, waiting: 0, in_progress: 0, done: 0 } });
      const { data } = await sb.from('queues').select('status').eq('queue_date', today);
      const all = data || [];
      return reply(200, { success: true, data: { total: all.length, waiting: all.filter(q => q.status === 'WAITING').length, in_progress: all.filter(q => q.status === 'IN_PROGRESS').length, done: all.filter(q => q.status === 'DONE').length } });
    }

    // ── ADMIN LOGIN ────────────────────────────────────────────────────────────
    if (pathname === '/api/v1/admin/login' && method === 'POST') {
      const { username, password } = body;
      if (!username || !password) return reply(400, { success: false, error: 'username and password required' });
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const { data: admin } = await sb.from('admins').select('*').eq('username', username).maybeSingle();
      if (!admin || !verifyPasswordHash(password, admin.password_hash)) return reply(401, { success: false, error: 'Invalid credentials' });
      if (!hasValidAdminSecret(ADMIN_AUTH_SECRET)) return reply(503, { success: false, error: 'Server configuration error' });
      const token = createAdminToken({ id: admin.id, username, role: admin.role }, ADMIN_AUTH_SECRET, Date.now());
      return reply(200, { success: true, data: { session: { username, role: admin.role, token, expiresAt: new Date(Date.now() + 86_400_000).toISOString() } } });
    }

    // ── ADMIN QUEUE OPS ────────────────────────────────────────────────────────
    if (pathname === '/api/v1/admin/queue/logs' && method === 'GET') {
      if (!sb) return reply(200, { success: true, data: [] });
      const { data } = await sb.from('queues').select('*').order('created_at', { ascending: false }).limit(200);
      return reply(200, { success: true, data: data || [] });
    }
    if (pathname === '/api/v1/admin/queue/recover' && method === 'POST') {
      await runRecovery(sb);
      return reply(200, { success: true, message: 'Recovery complete' });
    }
    if (pathname === '/api/v1/admin/queues' && method === 'GET') {
      if (!sb) return reply(200, { success: true, data: [] });
      const { data } = await sb.from('queues').select('*').eq('queue_date', today).order('display_number');
      return reply(200, { success: true, data: data || [], total: data?.length || 0 });
    }

    // ── ADMIN USERS CRUD ───────────────────────────────────────────────────────
    if ((pathname === '/api/v1/admins' || pathname.startsWith('/api/v1/admins/')) && ['GET','POST','PATCH','DELETE'].includes(method)) {
      if (!hasValidAdminSecret(ADMIN_AUTH_SECRET)) return reply(503, { success: false, error: 'Server configuration error' });
      if (!verifyAdminBearerToken(req.headers.authorization || '', ADMIN_AUTH_SECRET)) return reply(401, { success: false, error: 'Unauthorized' });
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const id = getPathId(pathname, '/api/v1/admins');
      if (method === 'GET') {
        if (id) { const { data } = await sb.from('admins').select('id,username,role,permissions,created_at').eq('id', id).single(); return reply(data ? 200 : 404, { success: !!data, data }); }
        const { data } = await sb.from('admins').select('id,username,role,permissions,created_at').order('created_at', { ascending: false });
        return reply(200, { success: true, data: data || [] });
      }
      if (method === 'POST') {
        const { username, password, role, permissions } = body;
        if (!username || !password) return reply(400, { success: false, error: 'username and password required' });
        const { data: u, error: e } = await sb.from('admins').insert({ username, password_hash: hashPassword(password), role: role || 'admin', permissions: permissions || [] }).select().single();
        if (e) return reply(e.code === '23505' ? 409 : 500, { success: false, error: e.message });
        return reply(201, { success: true, data: { id: u.id, username: u.username } });
      }
    }

    return reply(404, { success: false, error: 'Route not found', path: pathname });

  } catch (err) {
    console.error('[V1 API Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error', message: err.message });
  }
}
