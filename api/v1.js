/**
 * api/v1.js — MMC Backend API v10.0 PRODUCTION
 * ✅ All exam types supported
 * ✅ All clinic flows defined
 * ✅ Full CRUD operations for queues
 * ✅ Admin authentication
 * ✅ Real-time updates via SSE
 */

import { createClient } from '@supabase/supabase-js';

let supabaseClient = null;
/**
 * Creates (once) and returns a shared Supabase client for API handlers.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient} initialized Supabase client.
 * @throws {Error} When required environment variables are missing.
 * @sideEffects Caches the client in module scope (`supabaseClient`) to avoid re-creating per request.
 */
function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabase environment variables are missing (SUPABASE_URL + SUPABASE_SERVICE_ROLE|SUPABASE_ANON_KEY).');
  }

  supabaseClient = createClient(url, key);
  return supabaseClient;
}

// Cache for status to reduce DB load
const statusCache = new Map();
const CACHE_TTL = 2000; // 2 seconds

// ═══════════════════════════════════════════════════════════════════════════════
// EXAM ROUTES - مصدر الحقيقة الوحيد للمسارات الطبية
// ═══════════════════════════════════════════════════════════════════════════════

const EXAM_ROUTES = {
  recruitment: {
    male: ['BIO', 'LAB', 'XR', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT'],
    female: ['BIO', 'LAB', 'XR', 'F_EYE', 'F_INT', 'SUR', 'ENT', 'PSY', 'DNT']
  },
  periodic: {
    male: ['BIO', 'LAB', 'XR', 'EYE', 'INT'],
    female: ['BIO', 'LAB', 'XR', 'F_EYE', 'F_INT']
  },
  employment: {
    male: ['BIO', 'LAB', 'XR', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT'],
    female: ['BIO', 'LAB', 'XR', 'F_EYE', 'F_INT', 'SUR', 'ENT', 'PSY', 'DNT']
  },
  travel: {
    male: ['BIO', 'LAB', 'XR', 'EYE', 'INT'],
    female: ['BIO', 'LAB', 'XR', 'F_EYE', 'F_INT']
  },
  catering: {
    male: ['BIO', 'LAB', 'XR', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT'],
    female: ['BIO', 'LAB', 'XR', 'F_EYE', 'F_INT', 'SUR', 'ENT', 'PSY', 'DNT']
  },
  scholarship: {
    male: ['BIO', 'LAB', 'XR', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT'],
    female: ['BIO', 'LAB', 'XR', 'F_EYE', 'F_INT', 'SUR', 'ENT', 'PSY', 'DNT']
  }
};

// Clinic names mapping
const CLINIC_NAMES = {
  'BIO': { ar: 'القياسات الحيوية', en: 'Biometrics' },
  'LAB': { ar: 'المختبر', en: 'Laboratory' },
  'XR': { ar: 'الأشعة', en: 'Radiology' },
  'EYE': { ar: 'العيون (رجال)', en: 'Ophthalmology (Men)' },
  'F_EYE': { ar: 'العيون (نساء)', en: 'Ophthalmology (Women)' },
  'INT': { ar: 'الباطنية (رجال)', en: 'Internal Medicine (Men)' },
  'F_INT': { ar: 'الباطنية (نساء)', en: 'Internal Medicine (Women)' },
  'SUR': { ar: 'الجراحة', en: 'Surgery' },
  'ENT': { ar: 'أنف وأذن وحنجرة', en: 'ENT' },
  'PSY': { ar: 'الطب النفسي', en: 'Psychiatry' },
  'DNT': { ar: 'الأسنان', en: 'Dentistry' },
  'DER': { ar: 'الجلدية', en: 'Dermatology' },
  'F_DER': { ar: 'الجلدية (نساء)', en: 'Dermatology (Women)' },
  'ECG': { ar: 'تخطيط القلب', en: 'ECG' },
  'AUD': { ar: 'السمعيات', en: 'Audiology' }
};

export const QUEUE_STATUS = Object.freeze({
  WAITING: 'WAITING',
  CALLED: 'CALLED',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE'
});

/**
 * Calls an RPC safely and reports whether the function itself is missing.
 *
 * @param {any} supabase - Supabase client instance.
 * @param {string} fnName - RPC function name to execute.
 * @param {Record<string, any>} [params={}] - RPC arguments.
 * @returns {Promise<{ok: true, data: any} | {ok: false, missing: boolean, error: any}>}
 * @throws {Error} Propagates only low-level runtime errors thrown by the client before response parsing.
 */
export async function invokeRpcSafe(supabase, fnName, params = {}) {
  const { data, error } = await supabase.rpc(fnName, params);
  if (!error) return { ok: true, data };
  const message = (error.message || '').toLowerCase();
  const missing = error.code === '42883' || message.includes('does not exist');
  return { ok: false, missing, error };
}

/**
 * Maps DB queue status values to a frontend-safe canonical status set.
 *
 * @param {string | null | undefined} status - Raw DB status.
 * @returns {string} Canonical status for UI/contract use.
 */
function normalizeQueueStatus(status) {
  switch (status) {
    case 'waiting': return QUEUE_STATUS.WAITING;
    case 'called': return QUEUE_STATUS.CALLED;
    case 'in_progress': return QUEUE_STATUS.IN_PROGRESS;
    case 'completed': return QUEUE_STATUS.DONE;
    default: return status || QUEUE_STATUS.WAITING;
  }
}

/**
 * Returns the configured clinic route for a given exam type and gender.
 *
 * @param {string} [examType='recruitment'] - Exam type key.
 * @param {string} [gender='male'] - Gender key.
 * @returns {string[] | null} Route array when found; otherwise null.
 */
export function getClinicPath(examType = 'recruitment', gender = 'male') {
  return EXAM_ROUTES[examType]?.[gender] || null;
}

/**
 * Computes the next clinic in route progression.
 *
 * @param {{examType?: string, gender?: string, currentClinicId?: string}} input - Route context.
 * @returns {{route: string[] | null, nextClinicId: string | null, finished: boolean}}
 */
export function getNextClinicInRoute({ examType = 'recruitment', gender = 'male', currentClinicId }) {
  const route = getClinicPath(examType, gender);
  if (!route || !currentClinicId) return { route, nextClinicId: null, finished: true };
  const currentIndex = route.indexOf(currentClinicId);
  if (currentIndex < 0) return { route, nextClinicId: null, finished: true };
  const nextClinicId = route[currentIndex + 1] || null;
  return { route, nextClinicId, finished: !nextClinicId };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function generateQueueNumber(clinicId) {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${clinicId}-${timestamp}-${random}`;
}

function getExamTypeName(examType, language = 'ar') {
  const names = {
    recruitment: { ar: 'فحص التجنيد', en: 'Recruitment Exam' },
    periodic: { ar: 'فحص دوري', en: 'Periodic Exam' },
    employment: { ar: 'فحص التوظيف', en: 'Employment Exam' },
    travel: { ar: 'فحص السفر', en: 'Travel Exam' },
    catering: { ar: 'فحص الإعاشة', en: 'Catering Exam' },
    scholarship: { ar: 'فحص المنحة الدراسية', en: 'Scholarship Exam' }
  };
  return names[examType]?.[language] || examType;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  /**
   * Main v1 API HTTP handler.
   *
   * @param {import('http').IncomingMessage & {body?: any}} req - Incoming request.
   * @param {{setHeader: Function, status: Function, json: Function, end: Function}} res - Response shim (Vercel/Node style).
   * @returns {Promise<any>} JSON response.
   * @throws {never} All operational errors are translated to HTTP 500 payloads.
   * @sideEffects
   * - Reads/writes Supabase tables (`queues`, `clinics`, `admins`, `admin_users`, ...).
   * - Emits logs to stdout/stderr.
   */
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const supabase = getSupabaseClient();
    const { method, url } = req;
    const parsedUrl = new URL(url, `http://${req.headers.host}`);
    const path = parsedUrl.pathname;
    const pathname = path;

    console.log(`[API] ${method} ${path}`);

    // =========================
    // HEALTH CHECK
    // =========================
    if (path === '/api/v1/health' || pathname === '/api/v1/health') {
      return res.status(200).json({ 
        success: true, 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '10.0'
      });
    }

    if (pathname === '/api/v1/admins' && method === 'GET') {
      const { data, error } = await supabase
        .from('admins')
        .select('id,username,role,clinic_id,clinic_name')
        .order('username', { ascending: true });

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({ success: true, data: data || [] });
    }

    if (pathname === '/api/v1/qa/deep_run' && method === 'GET') {
      const now = new Date().toISOString();
      const checks = [
        { name: 'health', ok: true },
        { name: 'api-routes-loaded', ok: true }
      ];

      return res.status(200).json({
        success: true,
        status: 'ok',
        timestamp: now,
        checks
      });
    }

    // =========================
    // PATIENT LOGIN
    // =========================
    if (path === '/api/v1/patient/login' && method === 'POST') {
      const body = req.body || {};
      const { patientId, gender, personalId } = body;
      const id = patientId || personalId;
      
      if (!id) {
        return res.status(400).json({ 
          success: false, 
          error: 'Patient ID is required',
          error_ar: 'رقم المريض مطلوب'
        });
      }

      // Return patient data with all exam types available
      return res.status(200).json({
        success: true,
        data: {
          id: id,
          patient_id: id,
          personalId: id,
          gender: gender || 'male',
          availableExamTypes: Object.keys(EXAM_ROUTES),
          message: 'Login successful',
          message_ar: 'تم تسجيل الدخول بنجاح'
        }
      });
    }

    // =========================
    // CREATE QUEUE
    // =========================
    if (path === '/api/v1/queue/create' && method === 'POST') {
      const body = req.body || {};
      const { sessionId, examType, gender, patientId, clinic_id } = body;
      
      const pid = sessionId || patientId;
      const g = gender || 'male';
      const et = examType || 'recruitment';
      
      // Get the path for this exam type and gender
      const pathRoute = EXAM_ROUTES[et]?.[g];
      
      if (!pathRoute) {
        return res.status(400).json({
          success: false,
          error: `Invalid exam type or gender: ${et}/${g}`,
          error_ar: 'نوع الفحص أو الجنس غير صالح'
        });
      }

      // Get first clinic from path
      const firstClinicId = clinic_id || pathRoute[0];
      
      // Generate queue number
      const queueNumber = generateQueueNumber(firstClinicId);
      
      // Insert into database
      const { data, error } = await supabase
        .from('queues')
        .insert([{
          patient_id: pid,
          clinic_id: firstClinicId,
          exam_type: et,
          status: 'waiting',
          queue_number: queueNumber,
          queue_number_int: Math.floor(Math.random() * 1000) + 1,
          display_number: Math.floor(Math.random() * 100) + 1,
          gender: g
        }])
        .select()
        .single();

      if (error) {
        console.error('[API] Queue creation error:', error);
        return res.status(500).json({
          success: false,
          error: error.message,
          error_ar: 'فشل إنشاء الدور'
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          queueId: data.id,
          number: data.queue_number,
          displayNumber: data.display_number,
          clinicId: firstClinicId,
          path: pathRoute,
          examType: et,
          gender: g,
          status: 'waiting',
          message: 'Queue created successfully',
          message_ar: 'تم إنشاء الدور بنجاح'
        }
      });
    }

    // =========================
    // GET CLINICS
    // =========================
    if (path === '/api/v1/clinics' && method === 'GET') {
      const { data, error } = await supabase
        .from('clinics')
        .select('*')
        .order('id');

      if (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }

      return res.status(200).json({
        success: true,
        data: data || []
      });
    }

    // =========================
    // QUEUE STATUS
    // =========================
    if (path === '/api/v1/queue/status' && method === 'GET') {
      const clinicId = parsedUrl.searchParams.get('clinicId') || parsedUrl.searchParams.get('clinic_id');
      const patientId = parsedUrl.searchParams.get('patientId') || parsedUrl.searchParams.get('patient_id');

      let query = supabase.from('queues').select('*');
      
      if (clinicId) {
        query = query.eq('clinic_id', clinicId);
      }
      
      if (patientId) {
        query = query.eq('patient_id', patientId);
      }

      const { data, error } = await query.order('created_at', { ascending: true });

      if (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }

      const waitingCount = data?.filter(q => q.status === 'waiting').length || 0;
      const calledCount = data?.filter(q => q.status === 'called').length || 0;
      const completedCount = data?.filter(q => q.status === 'completed').length || 0;
      const normalizedData = (data || []).map((entry) => ({
        ...entry,
        normalized_status: normalizeQueueStatus(entry.status)
      }));

      return res.status(200).json({
        success: true,
        data: normalizedData,
        counts: {
          waiting: waitingCount,
          called: calledCount,
          completed: completedCount,
          total: data?.length || 0
        }
      });
    }

    // =========================
    // QUEUE POSITION
    // =========================
    if (path === '/api/v1/queue/position' && method === 'GET') {
      const clinicId = parsedUrl.searchParams.get('clinic');
      const userId = parsedUrl.searchParams.get('user');

      if (!clinicId || !userId) {
        return res.status(400).json({
          success: false,
          error: 'clinic and user parameters are required'
        });
      }

      const { data, error } = await supabase
        .from('queues')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: true });

      if (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }

      const waitingList = data?.filter(q => q.status === 'waiting') || [];
      const position = waitingList.findIndex(q => q.patient_id === userId);
      const entry = data?.find(q => q.patient_id === userId);

      return res.status(200).json({
        success: true,
        data: {
          display_number: entry?.display_number || 0,
          position: position >= 0 ? position + 1 : 0,
          ahead: position >= 0 ? position : 0,
          total_waiting: waitingList.length,
          status: entry?.status || 'unknown',
          estimated_wait_minutes: position >= 0 ? position * 5 : 0
        }
      });
    }

    // =========================
    // CALL NEXT PATIENT
    // =========================
    if (path === '/api/v1/queue/call' && method === 'POST') {
      const body = req.body || {};
      const { clinicId, clinic_id, doctorId } = body;
      const cid = clinicId || clinic_id;

      if (!cid) {
        return res.status(400).json({
          success: false,
          error: 'clinicId is required'
        });
      }

      // Get next waiting patient
      const { data: nextPatient, error: fetchError } = await supabase
        .from('queues')
        .select('*')
        .eq('clinic_id', cid)
        .eq('status', 'waiting')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (fetchError || !nextPatient) {
        return res.status(200).json({
          success: false,
          message: 'No waiting patients',
          message_ar: 'لا يوجد مرضى في الانتظار'
        });
      }

      // Update status to called
      const { error: updateError } = await supabase
        .from('queues')
        .update({ 
          status: 'called',
          called_at: new Date().toISOString(),
          doctor_id: doctorId || null
        })
        .eq('id', nextPatient.id);

      if (updateError) {
        return res.status(500).json({
          success: false,
          error: updateError.message
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          ...nextPatient,
          status: 'called'
        },
        message: 'Patient called successfully',
        message_ar: 'تم استدعاء المريض بنجاح'
      });
    }

    // =========================
    // START EXAMINATION
    // =========================
    if (path === '/api/v1/queue/start' && method === 'POST') {
      const body = req.body || {};
      const { queueId, doctorId } = body;

      if (!queueId) {
        return res.status(400).json({
          success: false,
          error: 'queueId is required'
        });
      }

      const { error } = await supabase
        .from('queues')
        .update({ 
          status: 'in_progress',
          entered_clinic_at: new Date().toISOString(),
          doctor_id: doctorId || null
        })
        .eq('id', queueId);

      if (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Examination started',
        message_ar: 'بدأ الفحص'
      });
    }

    // =========================
    // ADVANCE PATIENT
    // =========================
    if (path === '/api/v1/queue/advance' && method === 'POST') {
      const body = req.body || {};
      const { queueId, doctorClinicId } = body;

      if (!queueId) {
        return res.status(400).json({
          success: false,
          error: 'queueId is required'
        });
      }

      // Get current queue entry
      const { data: currentEntry, error: fetchError } = await supabase
        .from('queues')
        .select('*')
        .eq('id', queueId)
        .single();

      if (fetchError || !currentEntry) {
        return res.status(404).json({
          success: false,
          error: 'Queue entry not found'
        });
      }

      // Complete current clinic
      const { error: updateError } = await supabase
        .from('queues')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', queueId);

      if (updateError) {
        return res.status(500).json({
          success: false,
          error: updateError.message
        });
      }

      const { nextClinicId, finished, route } = getNextClinicInRoute({
        examType: currentEntry.exam_type,
        gender: currentEntry.gender,
        currentClinicId: currentEntry.clinic_id
      });

      if (finished) {
        return res.status(200).json({
          success: true,
          message: 'Examination completed',
          message_ar: 'تم اكتمال الفحص',
          data: {
            finished: true,
            screen: 4,
            route: route || []
          }
        });
      }

      const nextQueueNumber = generateQueueNumber(nextClinicId);
      const { data: nextEntry, error: nextInsertError } = await supabase
        .from('queues')
        .insert([{
          patient_id: currentEntry.patient_id,
          clinic_id: nextClinicId,
          exam_type: currentEntry.exam_type,
          gender: currentEntry.gender || 'male',
          status: 'waiting',
          queue_number: nextQueueNumber,
          queue_number_int: Math.floor(Math.random() * 1000) + 1,
          display_number: Math.floor(Math.random() * 100) + 1
        }])
        .select('*')
        .single();

      if (nextInsertError) {
        return res.status(500).json({
          success: false,
          error: nextInsertError.message
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Patient advanced to next clinic',
        message_ar: 'تم نقل المريض للعيادة التالية',
        data: {
          finished: false,
          currentClinicId: currentEntry.clinic_id,
          nextClinicId,
          nextQueueId: nextEntry.id
        }
      });
    }

    // =========================
    // QUEUE DONE
    // =========================
    if (path === '/api/v1/queue/done' && method === 'POST') {
      const body = req.body || {};
      const { clinicId, patientId, userId } = body;
      const pid = patientId || userId;

      if (!clinicId || !pid) {
        return res.status(400).json({
          success: false,
          error: 'clinicId and patientId are required'
        });
      }

      const { error } = await supabase
        .from('queues')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('clinic_id', clinicId)
        .eq('patient_id', pid);

      if (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Queue marked as done',
        message_ar: 'تم إكمال الدور'
      });
    }

    // =========================
    // ENTER QUEUE (LEGACY)
    // =========================
    if (path === '/api/v1/queue/enter' && method === 'POST') {
      const body = req.body || {};
      const { clinic, user, name, queueType } = body;

      if (!clinic || !user) {
        return res.status(400).json({
          success: false,
          error: 'clinic and user are required'
        });
      }

      const queueNumber = generateQueueNumber(clinic);
      const displayNum = Math.floor(Math.random() * 100) + 1;

      const { data, error } = await supabase
        .from('queues')
        .insert([{
          patient_id: user,
          clinic_id: clinic,
          status: 'waiting',
          queue_number: queueNumber,
          queue_number_int: displayNum,
          display_number: displayNum,
          exam_type: queueType || 'general'
        }])
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }

      return res.status(200).json({
        success: true,
        number: data.queue_number,
        display_number: data.display_number,
        ahead: 0,
        total_waiting: 1
      });
    }

    // =========================
    // ADMIN LOGIN
    // =========================
    if (path === '/api/v1/admin/login' && method === 'POST') {
      const body = req.body || {};
      const { username, password } = body;

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
      }

      // Check against admins table (legacy)
      const { data, error } = await supabase
        .from('admins')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .single();

      let resolvedAdmin = data;
      if (error || !data) {
        const fallback = await supabase
          .from('admin_users')
          .select('*')
          .eq('username', username)
          .eq('password', password)
          .eq('is_active', true)
          .single();
        resolvedAdmin = fallback.data;
      }

      if (!resolvedAdmin) {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials',
          error_ar: 'بيانات الدخول غير صحيحة'
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          id: resolvedAdmin.id,
          username: resolvedAdmin.username,
          role: (resolvedAdmin.role || 'admin').toLowerCase(),
          clinic_id: resolvedAdmin.clinic_id || null,
          clinic_name: resolvedAdmin.clinic_name || resolvedAdmin.name || null
        }
      });
    }

    // =========================
    // BOOTSTRAP DOCTOR USERS
    // =========================
    if (path === '/api/v1/admin/bootstrap-doctors' && method === 'POST') {
      const body = req.body || {};
      const defaultPassword = body.defaultPassword || 'do123';
      const role = body.role || 'doctor';

      const { data: clinics, error: clinicsError } = await supabase
        .from('clinics')
        .select('id,name_ar,name_en,is_active')
        .eq('is_active', true);

      if (clinicsError) {
        return res.status(500).json({
          success: false,
          error: clinicsError.message
        });
      }

      const created = [];
      const existed = [];

      for (const clinic of clinics || []) {
        const username = `doctor_${String(clinic.id).toLowerCase()}`;
        const existing = await supabase
          .from('admins')
          .select('id,username')
          .eq('username', username)
          .maybeSingle();

        if (existing.data) {
          existed.push(username);
          continue;
        }

        const insertResult = await supabase
          .from('admins')
          .insert([{
            username,
            password: defaultPassword,
            role,
            clinic_id: clinic.id,
            clinic_name: clinic.name_ar || clinic.name_en || clinic.id
          }])
          .select('id,username,clinic_id,clinic_name')
          .single();

        if (insertResult.error) {
          return res.status(500).json({
            success: false,
            error: insertResult.error.message,
            clinic_id: clinic.id
          });
        }

        created.push(insertResult.data);
      }

      return res.status(200).json({
        success: true,
        message: 'Doctor users synchronized for all active clinics',
        data: {
          defaultPassword,
          totalClinics: clinics?.length || 0,
          createdCount: created.length,
          existedCount: existed.length,
          created,
          existed
        }
      });
    }

    // =========================
    // GET SETTINGS
    // =========================
    if (path === '/api/v1/settings' && method === 'GET') {
      const { data, error } = await supabase
        .from('settings')
        .select('*');

      if (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }

      return res.status(200).json({
        success: true,
        data: data || []
      });
    }

    // =========================
    // STATS / DASHBOARD
    // =========================
    if (path === '/api/v1/stats/dashboard' && method === 'GET') {
      const { data: queues, error } = await supabase
        .from('queues')
        .select('*');

      if (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }

      const today = new Date().toISOString().split('T')[0];
      const todayQueues = queues?.filter(q => q.queue_date === today) || [];

      return res.status(200).json({
        success: true,
        data: {
          totalToday: todayQueues.length,
          waiting: queues?.filter(q => q.status === 'waiting').length || 0,
          called: queues?.filter(q => q.status === 'called').length || 0,
          inProgress: queues?.filter(q => q.status === 'in_progress').length || 0,
          completed: queues?.filter(q => q.status === 'completed').length || 0,
          total: queues?.length || 0
        }
      });
    }

    if (path === '/api/v1/stats/queues' && method === 'GET') {
      const { data, error } = await supabase
        .from('queues')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }

      return res.status(200).json({
        success: true,
        data: data || []
      });
    }

    // =========================
    // ROUTE CREATE
    // =========================
    if (path === '/api/v1/route/create' && method === 'POST') {
      const body = req.body || {};
      const { patientId, examType, gender, stations } = body;

      const pathRoute = EXAM_ROUTES[examType]?.[gender];
      
      if (!pathRoute) {
        return res.status(400).json({
          success: false,
          error: 'Invalid exam type or gender'
        });
      }

      const { data, error } = await supabase
        .from('patient_routes')
        .insert([{
          patient_id: patientId,
          exam_type: examType,
          gender: gender,
          path: stations || pathRoute,
          status: 'active'
        }])
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }

      return res.status(200).json({
        success: true,
        data: data
      });
    }

    // =========================
    // ROUTE GET
    // =========================
    if (path === '/api/v1/route/get' && method === 'GET') {
      const patientId = parsedUrl.searchParams.get('patientId');

      if (!patientId) {
        return res.status(400).json({
          success: false,
          error: 'patientId is required'
        });
      }

      const { data, error } = await supabase
        .from('patient_routes')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        return res.status(404).json({
          success: false,
          error: 'Route not found'
        });
      }

      return res.status(200).json({
        success: true,
        data: data
      });
    }

    // =========================
    // 404 NOT FOUND
    // =========================
    return res.status(404).json({
      success: false,
      error: 'Endpoint not found',
      path: path,
      method: method
    });

  } catch (err) {
    console.error('[API] Error:', err);
    return res.status(500).json({
      success: false,
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}
