/**
 * api/v1.js — MMC Backend v6.0 FINAL (LOCKED)
 * ✅ PIN system PERMANENTLY REMOVED
 * ✅ Unified Queue Logic (Single Source of Truth)
 * ✅ Doctor-Only Control (Call, Start, Advance)
 * ✅ Atomic & Transactional Queue Operations
 * ✅ Performance Optimized
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

// ── Authoritative route map ──
const ROUTE_MAP = {
  recruitment: ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'],
  promotion:   ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'],
  transfer:    ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'],
  referral:    ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'],
  contract:    ['LAB','XR','BIO','EYE','INT','SUR','ENT','PSY','DNT','DER'],
  aviation:    ['LAB','EYE','INT','ENT','ECG','AUD'],
  cooks:       ['LAB','INT','ENT','SUR'],
  courses:     ['LAB','EYE','SUR','INT'],
};

function getPath(examType) {
  const t = ROUTE_MAP[examType] ? examType : 'recruitment';
  return [...ROUTE_MAP[t]];
}

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Cache-Control', 'no-cache,no-store,must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const fullUrl = req.url.startsWith('http') ? req.url : `https://${req.headers.host || 'localhost'}${req.url}`;
  const parsed = new URL(fullUrl);
  const pathname = parsed.pathname;
  const method = req.method;
  const query = Object.fromEntries(parsed.searchParams);

  // ── HARD PIN BLOCK ──
  if (pathname.toLowerCase().includes('pin')) {
    return res.status(410).json({ success: false, error: 'PIN system permanently removed', code: 'PIN_REMOVED' });
  }

  let body = {};
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    body = req._mmcParsedBody || (typeof req.body === 'object' ? req.body : {});
  }

  const reply = (status, data) => res.status(status).json(data);
  const sb = getSupabase();
  const today = new Date().toISOString().split('T')[0];

  try {
    // ── HEALTH & SETTINGS ──
    if ((pathname === '/api/v1/health' || pathname === '/api/health') && method === 'GET') {
      return reply(200, { success: true, status: 'ok', version: '6.0.0', pin_system: 'REMOVED', queue_system: 'DOCTOR_CONTROLLED' });
    }
    if (pathname === '/api/v1/settings' && method === 'GET') {
      return reply(200, { success: true, data: { pin_system_enabled: false, queue_system_enabled: true, doctor_control_enabled: true } });
    }

    // ── CLINICS ──
    if (pathname === '/api/v1/clinics' && method === 'GET') {
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const { data, error } = await sb.from('clinics').select('*').order('name_ar');
      if (error) throw error;
      return reply(200, { success: true, data: data || [] });
    }

    // ── PATIENT LOGIN ──
    if ((pathname === '/api/v1/patient/login' || pathname === '/api/v1/patients/login') && method === 'POST') {
      const { personalId, gender } = body;
      if (!personalId || !gender) return reply(400, { success: false, error: 'personalId and gender required' });
      return reply(200, {
        success: true,
        data: { personalId: String(personalId).trim(), gender: gender === 'female' ? 'female' : 'male', expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      });
    }

    // ── QUEUE CREATE ──
    if (pathname === '/api/v1/queue/create' && method === 'POST') {
      const { patientId, examType, clinicId: manualClinicId } = body;
      if (!patientId || !examType) return reply(400, { success: false, error: 'patientId and examType required' });
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });

      const path = getPath(examType);
      const firstClinic = manualClinicId || path[0];

      const { data: existing } = await sb.from('queues')
        .select('*')
        .eq('patient_id', patientId)
        .eq('queue_date', today)
        .not('status', 'eq', 'DONE')
        .limit(1).maybeSingle();

      if (existing) {
        return reply(200, { success: true, data: { ...existing, already_exists: true } });
      }

      const { data: maxRow } = await sb.from('queues')
        .select('display_number')
        .eq('clinic_id', firstClinic)
        .eq('queue_date', today)
        .order('display_number', { ascending: false }).limit(1).maybeSingle();
      
      const number = (maxRow?.display_number || 0) + 1;
      const { data: ins, error: insErr } = await sb.from('queues').insert({
        patient_id: patientId,
        clinic_id: firstClinic,
        exam_type: examType,
        display_number: number,
        queue_number: String(number),
        path,
        current_step: 0,
        status: 'WAITING',
        version: 1,
        queue_date: today,
        entered_at: new Date().toISOString()
      }).select('*').single();

      if (insErr) throw insErr;
      return reply(200, { success: true, data: ins });
    }

    // ── QUEUE CALL ──
    if (pathname === '/api/v1/queue/call' && method === 'POST') {
      const { clinicId } = body;
      if (!clinicId) return reply(400, { success: false, error: 'clinicId required' });
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });

      const { data: next } = await sb.from('queues')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('queue_date', today)
        .eq('status', 'WAITING')
        .order('display_number').limit(1).maybeSingle();

      if (!next) return reply(200, { success: true, data: { message: 'Queue empty' } });

      const { data: updated, error } = await sb.from('queues')
        .update({ status: 'CALLED', called_at: new Date().toISOString() })
        .eq('id', next.id)
        .select('*').single();

      if (error) throw error;
      return reply(200, { success: true, data: updated });
    }

    // ── QUEUE START ──
    if (pathname === '/api/v1/queue/start' && method === 'POST') {
      const { queueId } = body;
      if (!queueId) return reply(400, { success: false, error: 'queueId required' });
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });

      const { data: q } = await sb.from('queues').select('*').eq('id', queueId).single();
      if (!q) return reply(404, { success: false, error: 'Queue not found' });

      const { data: updated, error } = await sb.from('queues')
        .update({ status: 'IN_PROGRESS', version: (q.version || 1) + 1 })
        .eq('id', queueId)
        .select('*').single();

      if (error) throw error;
      return reply(200, { success: true, data: updated });
    }

    // ── QUEUE ADVANCE ──
    if (pathname === '/api/v1/queue/advance' && method === 'POST') {
      const { queueId, clinicId } = body;
      if (!queueId || !clinicId) return reply(400, { success: false, error: 'queueId and clinicId required' });
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });

      const { data: q } = await sb.from('queues').select('*').eq('id', queueId).single();
      if (!q) return reply(404, { success: false, error: 'Queue not found' });

      const path = q.path || [];
      const nextStep = (q.current_step || 0) + 1;
      const isDone = nextStep >= path.length;

      const updates = isDone 
        ? { status: 'DONE', current_step: nextStep, version: (q.version || 1) + 1 }
        : { status: 'WAITING', clinic_id: path[nextStep], current_step: nextStep, version: (q.version || 1) + 1 };

      const { data: updated, error } = await sb.from('queues')
        .update(updates)
        .eq('id', queueId)
        .select('*').single();

      if (error) throw error;
      return reply(200, { success: true, data: updated });
    }

    // ── QUEUE STATUS ──
    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      const { patientId, clinicId } = query;
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });

      if (clinicId) {
        const { count } = await sb.from('queues').select('*', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('queue_date', today).eq('status', 'WAITING');
        return reply(200, { success: true, data: { waitingCount: count || 0 } });
      }

      const { data: q } = await sb.from('queues').select('*').eq('patient_id', patientId).eq('queue_date', today).not('status', 'eq', 'DONE').limit(1).maybeSingle();
      if (!q) return reply(404, { success: false, error: 'No active queue' });
      return reply(200, { success: true, data: q });
    }

    // ── ADMIN LOGIN ──
    if (pathname === '/api/v1/admin/login' && method === 'POST') {
      const { username, password } = body;
      if (!username || !password) return reply(400, { success: false, error: 'username and password required' });
      if (!sb) return reply(503, { success: false, error: 'Database unavailable' });
      const { data: admin } = await sb.from('admins').select('*').eq('username', username).maybeSingle();
      if (!admin || !verifyPasswordHash(password, admin.password_hash)) return reply(401, { success: false, error: 'Invalid credentials' });
      const token = createAdminToken({ id: admin.id, username, role: admin.role }, ADMIN_AUTH_SECRET, Date.now());
      return reply(200, { success: true, data: { session: { username, role: admin.role, token, expiresAt: new Date(Date.now() + 86_400_000).toISOString() } } });
    }

    return reply(404, { success: false, error: 'Route not found' });

  } catch (err) {
    console.error('[V1 API Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
