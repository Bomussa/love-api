import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createAdminToken, verifyAdminBearerToken, hasValidAdminSecret, verifyAdminPassword } from '../lib/admin-auth.js';
import { handleAdminReports, handleAdminUsers, handleActivityLog, handleNotifications } from './admin-endpoints.js';
import { handleDashboardStats, handleClinicStats, handleServiceHealth } from './dashboard-endpoints.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const ADMIN_AUTH_SECRET = process.env.ADMIN_AUTH_SECRET;

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: true, persistSession: false },
    db: { schema: 'public' },
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyAdminToken(authorizationHeader) {
  return { ok: verifyAdminBearerToken(authorizationHeader, ADMIN_AUTH_SECRET) };
}

function getAuthorizationHeader(headers = {}) {
  return headers.authorization || headers.Authorization || '';
}

function normalizePatientIdentifier(rawValue) {
  return String(rawValue ?? '').trim();
}

function normalizeGender(rawValue) {
  return rawValue === 'female' ? 'female' : 'male';
}

function generateSecureTwoDigitPin() {
  return String(crypto.randomInt(10, 100)).padStart(2, '0');
}

async function findUsablePinRecord(supabase, clinicId, pin) {
  // ✅ استخدام جدول pins مع الأعمدة الصحيحة (Canonical)
  const canonical = await supabase
    .from('pins')
    .select('id, clinic_id, pin, valid_until, used_at')
    .eq('clinic_id', clinicId)
    .eq('pin', pin)
    .maybeSingle();

  if (!canonical.error && canonical.data) {
    const valid = !canonical.data.used_at && (!canonical.data.valid_until || new Date(canonical.data.valid_until) >= new Date());
    if (valid) return { mode: 'canonical', record: canonical.data };
  }

  // دعم Legacy (إذا كان ما زال مستخدماً)
  const legacy = await supabase
    .from('pins')
    .select('id, clinic_code, pin, expires_at, used_count, max_uses, is_active')
    .eq('clinic_code', clinicId)
    .eq('pin', pin)
    .maybeSingle();

  if (!legacy.error && legacy.data) {
    const valid = legacy.data.is_active !== false
      && Number(legacy.data.used_count || 0) < Number(legacy.data.max_uses || 1)
      && (!legacy.data.expires_at || new Date(legacy.data.expires_at) >= new Date());
    if (valid) return { mode: 'legacy', record: legacy.data };
  }

  return null;
}

async function buildQueueStatusPayload(supabase, clinicId) {
  const today = new Date().toISOString().split('T')[0];
  // ✅ استخدام جدول queues بدلاً من unified_queue (Canonical)
  const { data, error } = await supabase
    .from('queues')
    .select('id, patient_id, display_number, status, entered_at, called_at, completed_at, queue_date')
    .eq('clinic_id', clinicId)
    .eq('queue_date', today)
    .order('entered_at', { ascending: true });
    
  if (error) throw error;
  const rows = data || [];
  const currentActive = rows.filter((r) => r.status === 'serving' || r.status === 'called').sort((a, b) => new Date(b.called_at || b.entered_at) - new Date(a.called_at || a.entered_at))[0];
  const currentDone = rows.filter((r) => r.status === 'completed').sort((a, b) => new Date(b.completed_at || b.entered_at) - new Date(a.completed_at || a.entered_at))[0];
  const waitingRows = rows.filter((r) => r.status === 'waiting');
  
  return {
    clinicId,
    queueLength: waitingRows.length,
    currentNumber: currentActive?.display_number || currentDone?.display_number || 0,
    patients: waitingRows.map((r) => ({ position: r.display_number, enteredAt: r.entered_at, patientId: r.patient_id })),
    lastUpdated: rows[rows.length - 1]?.entered_at || null,
  };
}

export default async function handler(req, res) {
  const { setCorsHeaders } = await import('../lib/helpers-enhanced.js');
  setCorsHeaders(res, req);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = getSupabaseClient();
  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Server is missing Supabase environment configuration.' });
  }

  let body = {};
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    if (typeof req.body === 'string') {
      try { body = JSON.parse(req.body); } catch { body = {}; }
    } else {
      body = req.body || {};
    }
  }
  req._mmcParsedBody = body;

  const { method, url } = req;
  const fullUrl = url.startsWith('http') ? url : `https://${req.headers.host || 'localhost'}${url}`;
  const parsedUrl = new URL(fullUrl);
  const pathname = parsedUrl.pathname;
  
  try {
    if (pathname === '/api/v1/health' || pathname === '/api/health') {
      return res.status(200).json({ status: 'ok', ok: true, version: '3.9.3-canonical-fix', timestamp: new Date().toISOString() });
    }

    if (pathname === '/api/v1/status' && method === 'GET') {
      return res.status(200).json({
        success: true,
        data: {
          status: 'healthy',
          mode: 'online',
          backend: 'up',
          platform: 'vercel',
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ==================== PATIENT LOGIN ====================
    if ((pathname === '/api/v1/patient/login' || pathname === '/api/v1/patients/login') && method === 'POST') {
      const patientId = normalizePatientIdentifier(body.personalId || body.patientId);
      if (!patientId) return res.status(400).json({ success: false, error: 'Missing required field: personalId|patientId' });
      const gender = normalizeGender(body.gender);
      const { data: patientRow, error: patientError } = await supabase
        .from('patients')
        .upsert([{ patient_id: patientId, gender, status: 'active' }], { onConflict: 'patient_id' })
        .select()
        .single();
      if (patientError) return res.status(500).json({ success: false, error: 'PATIENT_UPSERT_FAILED', details: patientError.message });
      return res.status(200).json({ success: true, data: { patient: patientRow } });
    }

    // ==================== PIN VERIFICATION & QUEUE COMPLETION ====================
    if (pathname === '/api/v1/pin/verify' && method === 'POST') {
      const clinicId = String(body.clinicId || body.clinic_id || '').trim();
      const pin = String(body.pin || '').trim();
      const patientId = String(body.patientId || '').trim();
      const action = body.action; // 'complete' or null

      if (!clinicId || !pin) return res.status(400).json({ success: false, error: 'Missing required fields: clinicId, pin' });
      
      const pinMatch = await findUsablePinRecord(supabase, clinicId, pin);
      if (!pinMatch) return res.status(401).json({ success: false, error: 'INVALID_PIN' });

      // If action is complete, also update the queue status
      if (action === 'complete' && patientId) {
        const nowIso = new Date().toISOString();
        const { error: queueError } = await supabase
          .from('queues')
          .update({
            status: 'completed',
            completed_at: nowIso,
            completed_by_pin: pin
          })
          .eq('clinic_id', clinicId)
          .eq('patient_id', patientId)
          .in('status', ['waiting', 'called', 'serving']);

        if (queueError) return res.status(500).json({ success: false, error: 'QUEUE_COMPLETE_FAILED', details: queueError.message });

        // Mark PIN as used
        if (pinMatch.mode === 'canonical') {
          await supabase.from('pins').update({ used_at: nowIso }).eq('id', pinMatch.record.id);
        } else {
          await supabase.from('pins').update({ 
            used_count: (pinMatch.record.used_count || 0) + 1,
            last_used_at: nowIso 
          }).eq('id', pinMatch.record.id);
        }
      }

      return res.status(200).json({ success: true, verified: true, clinicId });
    }

    // ==================== QUEUE OPERATIONS ====================
    if (pathname === '/api/v1/queue/enter' && method === 'POST') {
      const clinicId = String(body.clinicId || body.clinic_id || '').trim();
      const patientId = normalizePatientIdentifier(body.patientId || body.personalId);
      if (!clinicId || !patientId) {
        return res.status(400).json({ success: false, error: 'MISSING_REQUIRED_FIELDS', message: 'معرفة العيادة ورقم المراجع مطلوبة' });
      }
      
      const { data: clinic, error: clinicError } = await supabase
        .from('clinics')
        .select('id, name')
        .eq('id', clinicId)
        .maybeSingle();
      
      if (clinicError || !clinic) {
        return res.status(404).json({ success: false, error: 'CLINIC_NOT_FOUND', message: 'العيادة غير موجودة' });
      }
      
      // ✅ استخدام دالة RPC الموحدة التي تتعامل مع جداول queues
      const { data: rpcResult, error: rpcError } = await supabase.rpc('enter_unified_queue_safe', {
        p_clinic_id: clinicId,
        p_patient_id: patientId,
        p_patient_name: body.patientName || null,
        p_exam_type: body.examType || null,
      });
      
      if (rpcError || !rpcResult || rpcResult.length === 0) {
        return res.status(503).json({
          success: false,
          error: 'ATOMIC_QUEUE_RPC_UNAVAILABLE',
          details: rpcError?.message || 'Queue RPC returned no rows',
        });
      }
      
      const result = rpcResult[0];
      return res.status(200).json({ success: true, data: { id: result.id, display_number: result.display_number, status: result.status, alreadyExists: result.already_exists } });
    }

    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      const clinicId = String(parsedUrl.searchParams.get('clinicId') || parsedUrl.searchParams.get('clinic') || '').trim();
      if (!clinicId) return res.status(400).json({ success: false, error: 'MISSING_CLINIC_ID' });
      const payload = await buildQueueStatusPayload(supabase, clinicId);
      return res.status(200).json({ success: true, data: payload });
    }

    if (pathname === '/api/v1/queue/call' && method === 'POST') {
      const clinicId = String(body.clinicId || body.clinic_id || '').trim();
      if (!clinicId) return res.status(400).json({ success: false, error: 'MISSING_CLINIC_ID' });

      const today = new Date().toISOString().split('T')[0];
      const { data: nextInQueue, error: nextInQueueError } = await supabase
        .from('queues')
        .select('id, clinic_id, patient_id, display_number, queue_number_int, status')
        .eq('clinic_id', clinicId)
        .eq('queue_date', today)
        .eq('status', 'waiting')
        .order('queue_number_int', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (nextInQueueError) {
        return res.status(500).json({ success: false, error: 'QUEUE_CALL_FETCH_FAILED', details: nextInQueueError.message });
      }
      if (!nextInQueue) {
        return res.status(404).json({ success: false, error: 'NO_WAITING_PATIENTS' });
      }

      const nowIso = new Date().toISOString();
      const { data: calledRow, error: calledRowError } = await supabase
        .from('queues')
        .update({ status: 'called', called_at: nowIso })
        .eq('id', nextInQueue.id)
        .eq('clinic_id', clinicId)
        .select('id, clinic_id, patient_id, display_number, queue_number_int, status, called_at')
        .maybeSingle();

      if (calledRowError) {
        return res.status(500).json({ success: false, error: 'QUEUE_CALL_UPDATE_FAILED', details: calledRowError.message });
      }

      return res.status(200).json({ success: true, data: calledRow });
    }

    // ==================== CLINICS & SETTINGS ====================
    if (pathname === '/api/v1/clinics' && method === 'GET') {
      const { data, error } = await supabase.from('clinics').select('*').order('name_ar', { ascending: true });
      if (error) return res.status(500).json({ success: false, error: 'FETCH_CLINICS_FAILED', details: error.message });
      return res.status(200).json({ success: true, data });
    }

    if (pathname === '/api/v1/settings' && method === 'GET') {
      const { data, error } = await supabase.from('settings').select('*');
      if (error) return res.status(500).json({ success: false, error: 'FETCH_SETTINGS_FAILED', details: error.message });
      const settingsMap = {};
      data.forEach(s => { settingsMap[s.key] = s.value; });
      return res.status(200).json({ success: true, data: settingsMap });
    }

    // ==================== ADMIN OPERATIONS ====================
    if (pathname === '/api/v1/admin/login' && method === 'POST') {
      const { username, password } = body;
      if (!username || !password) return res.status(400).json({ success: false, error: 'MISSING_CREDENTIALS' });
      
      const { data: admin, error: adminError } = await supabase.from('admins').select('*').eq('username', username).maybeSingle();
      if (adminError) return res.status(500).json({ success: false, error: 'DB_ERROR' });
      
      const loginStatus = verifyAdminPassword(password, admin?.password_hash);
      if (!loginStatus) return res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS' });
      
      const nowMs = Date.now();
      const token = createAdminToken({ id: admin.id, username, role: admin.role }, ADMIN_AUTH_SECRET, nowMs);
      
      return res.status(200).json({ 
        success: true, 
        data: { 
          token, 
          role: admin.role, 
          username,
          expiresAt: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString()
        } 
      });
    }

    if (pathname === '/api/v1/admins' && method === 'GET') {
      const { data: admins, error: adminsError } = await supabase
        .from('admins')
        .select('id, username, role, created_at')
        .order('created_at', { ascending: false });
      if (adminsError) return res.status(500).json({ success: false, error: 'FETCH_ADMINS_FAILED', details: adminsError.message });
      return res.status(200).json({ success: true, data: admins || [] });
    }

    if (pathname === '/api/v1/qa/deep_run' && method === 'GET') {
      return res.status(200).json({
        success: true,
        data: {
          ok: true,
          checks: ['api_v1_loaded', 'supabase_client_configured'],
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (pathname.startsWith('/api/v1/admin/')) {
      const authHeader = getAuthorizationHeader(req.headers);
      if (!verifyAdminBearerToken(authHeader, ADMIN_AUTH_SECRET)) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED_ADMIN' });
      }

      if (pathname === '/api/v1/admin/dashboard/stats' && method === 'GET') {
        return handleDashboardStats(req, res, { supabase });
      }
      if (pathname === '/api/v1/admin/reports/daily' && method === 'GET') {
        return handleAdminReports(req, res, { supabase, ADMIN_AUTH_SECRET });
      }
    }

    // Lazy import prevents module-load crashes in canonical routes when legacy handler env is incomplete.
    const { default: delegatedV1Handler } = await import('../lib/api-handlers.js');
    return await delegatedV1Handler(req, res, { supabase, ADMIN_AUTH_SECRET });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
}
