import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

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

const BOOT = { recovered: false };
const RATE_WINDOWS = {
  createByIp: new Map(),
  doctorActions: new Map(),
};

/** @returns {string} ISO timestamp for now. */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Build the queue path from request metadata.
 * @param {string} examType
 * @param {string} gender
 * @returns {string[]}
 */
function getPath(examType, gender) {
  const g = (gender || '').toLowerCase() === 'female' ? 'female' : 'male';
  const t = ROUTE_MAP[examType] ? examType : 'recruitment';
  return [...ROUTE_MAP[t][g]];
}

/** @returns {import('@supabase/supabase-js').SupabaseClient|null} */
function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Sliding-window in-memory rate limit.
 * @param {Map<string, number[]>} bucket
 * @param {string} key
 * @param {number} limit
 * @param {number} windowMs
 * @returns {boolean}
 */
function checkRateLimit(bucket, key, limit, windowMs) {
  const base = Date.now();
  const active = (bucket.get(key) || []).filter((ts) => base - ts <= windowMs);
  if (active.length >= limit) {
    bucket.set(key, active);
    return false;
  }
  active.push(base);
  bucket.set(key, active);
  return true;
}

/**
 * State-machine guard used by tests and validations.
 * @param {{status:string,path?:string[]}} queue
 * @param {string} nextStatus
 * @param {number} nextStep
 */
export async function validateTransition(queue, nextStatus, nextStep) {
  const path = Array.isArray(queue.path) ? queue.path : [];
  if (nextStep > path.length) throw new Error('current_step exceeds path length');
  if (nextStatus === 'DONE' && nextStep < path.length) throw new Error('DONE before finishing path');

  const allowed = {
    WAITING: ['CALLED', 'IN_PROGRESS'],
    CALLED: ['IN_PROGRESS', 'WAITING'],
    IN_PROGRESS: ['WAITING', 'DONE'],
    DONE: [],
    CANCELLED: [],
  };

  if (!(allowed[queue.status] || []).includes(nextStatus)) {
    throw new Error(`invalid transition ${queue.status} -> ${nextStatus}`);
  }
}

/**
 * Recovery pass executed once per server boot.
 * Side effects: updates expired records and resets stale calls.
 * @param {import('@supabase/supabase-js').SupabaseClient|null} sb
 */
async function bootRecovery(sb) {
  if (!sb || BOOT.recovered) return;
  const now = nowIso();
  const cutoff = new Date(Date.now() - 120_000).toISOString();

  await sb.from('queues').update({ status: 'WAITING', updated_at: now }).eq('status', 'IN_PROGRESS').lt('updated_at', cutoff);
  await sb.from('queues').update({ status: 'WAITING', called_at: null, updated_at: now }).eq('status', 'CALLED').lt('called_at', cutoff);

  BOOT.recovered = true;
}

/**
 * Unified API entrypoint.
 * Throws only through JSON 5xx responses.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Idempotency-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if ((req.path || '').includes('pin')) return res.status(410).json({ success: false, error: 'Gone' });

  const fullUrl = req.url.startsWith('http') ? req.url : `https://${req.headers.host || 'localhost'}${req.url}`;
  const parsed = new URL(fullUrl);
  const pathname = parsed.pathname;
  const method = req.method;

  if (pathname.toLowerCase().includes('pin')) return res.status(410).json({ success: false, error: 'Gone' });

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const reply = (code, payload) => res.status(code).json(payload);

  const sb = getSupabase();
  await bootRecovery(sb);

  try {
    if (pathname === '/api/v1/health' && method === 'GET') {
      return reply(200, { success: true, status: 'ok', queue_engine: 'strict' });
    }

    if (pathname === '/api/v1/queue/create' && method === 'POST') {
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });

      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
      if (!checkRateLimit(RATE_WINDOWS.createByIp, ip, 30, 60_000)) {
        return reply(429, { success: false, error: 'Rate limit exceeded for create' });
      }

      const idempotencyKey = req.headers['idempotency-key'];
      if (idempotencyKey) {
        const { data: idRow } = await sb.from('idempotency_keys').select('response').eq('key', idempotencyKey).maybeSingle();
        if (idRow?.response) return reply(200, idRow.response);
      }

      const { patientId, sessionId, examType, gender } = body;
      const pid = patientId || sessionId;
      if (!pid || !examType || !gender) return reply(400, { success: false, error: 'patientId/sessionId, examType, gender required' });

      const path = getPath(examType, gender);
      const { data: created, error } = await sb.rpc('fn_create_queue_atomic', {
        p_patient_id: String(pid),
        p_exam_type: examType,
        p_path: path,
      });
      if (error) throw error;

      const payload = {
        success: true,
        data: {
          queueId: created.queue_id,
          number: created.number,
          status: 'WAITING',
          path,
          current_step: 0,
          version: created.version,
        },
      };

      if (idempotencyKey) {
        const { error: insertError } = await sb.from('idempotency_keys').insert({ key: idempotencyKey, response: payload, created_at: nowIso() });
        if (insertError) {
          const { data: stored } = await sb.from('idempotency_keys').select('response').eq('key', idempotencyKey).maybeSingle();
          if (stored?.response) return reply(200, stored.response);
          throw insertError;
        }
      }

      return reply(200, payload);
    }

    if (pathname === '/api/v1/queue/call' && method === 'POST') {
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const { doctorClinicId } = body;
      if (!doctorClinicId) return reply(400, { success: false, error: 'doctorClinicId required' });
      if (!checkRateLimit(RATE_WINDOWS.doctorActions, String(doctorClinicId), 60, 60_000)) {
        return reply(429, { success: false, error: 'Rate limit exceeded for call' });
      }

      const { data: called, error } = await sb.rpc('fn_call_queue_atomic', { p_clinic_id: doctorClinicId });
      if (error) return reply(409, { success: false, error: error.message });
      if (!called || (Array.isArray(called) && called.length === 0)) return reply(200, { success: true, data: null });
      return reply(200, { success: true, data: Array.isArray(called) ? called[0] : called });
    }

    if (pathname === '/api/v1/queue/start' && method === 'POST') {
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const { queueId, doctorClinicId, version } = body;
      if (!queueId || !doctorClinicId || version === undefined) return reply(400, { success: false, error: 'queueId, doctorClinicId, version required' });

      const { data: started, error } = await sb.rpc('fn_start_queue_atomic', {
        p_queue_id: queueId,
        p_doctor_clinic_id: doctorClinicId,
        p_expected_version: Number(version),
      });
      if (error) return reply(409, { success: false, error: error.message });
      return reply(200, { success: true, data: started });
    }

    if (pathname === '/api/v1/queue/advance' && method === 'POST') {
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const { queueId, doctorClinicId, version } = body;
      if (!queueId || !doctorClinicId || version === undefined) return reply(400, { success: false, error: 'queueId, doctorClinicId, version required' });
      if (!checkRateLimit(RATE_WINDOWS.doctorActions, String(doctorClinicId), 60, 60_000)) {
        return reply(429, { success: false, error: 'Rate limit exceeded for advance' });
      }

      const { data: advanced, error } = await sb.rpc('fn_advance_queue_atomic', {
        p_queue_id: queueId,
        p_doctor_clinic_id: doctorClinicId,
        p_expected_version: Number(version),
      });
      if (error) {
        if (error.message.includes('forbidden_clinic')) return reply(403, { success: false, error: 'forbidden_clinic' });
        return reply(409, { success: false, error: error.message });
      }

      return reply(200, { success: true, data: advanced });
    }

    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const queueId = parsed.searchParams.get('queueId');
      if (!queueId) return reply(400, { success: false, error: 'queueId required' });
      const { data: q } = await sb.from('queues').select('*').eq('id', queueId).maybeSingle();
      if (!q) return reply(404, { success: false, error: 'Queue not found' });
      return reply(200, { success: true, data: q });
    }

    return reply(404, { success: false, error: 'Route not found' });
  } catch (err) {
    return reply(500, { success: false, error: 'Internal server error', message: err.message });
  }
}

export function _testOnly_getRoutePath(examType, gender) {
  return getPath(examType, gender);
}

export function _testOnly_rateLimit(bucketName, key, limit, windowMs) {
  const bucket = RATE_WINDOWS[bucketName] || RATE_WINDOWS.doctorActions;
  return checkRateLimit(bucket, key, limit, windowMs);
}
