import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PATCH, PUT',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-version, idempotency-key',
};

// ============================================================================
// CONSTANTS & UTILITIES (FINAL CONTRACT)
// ============================================================================

export const QUEUE_STATUS = {
  WAITING: "WAITING",
  CALLED: "CALLED",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
};

// Helper to get current time in Qatar
function getQatarTime() {
  const now = new Date();
  const qatarOffset = 3 * 60; // UTC+3
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (qatarOffset * 60000)).toISOString();
}

function getTodayDate() {
  return getQatarTime().split('T')[0];
}

export function getNextClinicInRoute({ examType, gender, currentClinicId }) {
  const routeKey = `${String(examType || '').toLowerCase()}:${String(gender || '').toLowerCase()}`;
  
  // Define official routes
  const ROUTES = {
    'recruitment:male': ['BIO', 'ECG', 'AUD', 'XR', 'EYE', 'ENT', 'DNT', 'LAB'],
    'recruitment:female': ['BIO', 'ECG', 'AUD', 'XR', 'EYE', 'ENT', 'DNT', 'LAB'],
    'general:male': ['BIO', 'XR', 'EYE'],
    'general:female': ['BIO', 'XR', 'EYE'],
  };

  const route = ROUTES[routeKey] || [];
  if (!route.length) {
    return { nextClinicId: null, finished: true, route: [] };
  }

  const idx = route.indexOf(currentClinicId);
  if (idx === -1) {
    // If not in route, start from beginning
    return { nextClinicId: route[0] || null, finished: false, route };
  }

  const nextClinicId = route[idx + 1] || null;
  return { nextClinicId, finished: !nextClinicId, route };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async function handler(req, res) {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).set(corsHeaders).end();
  }

  // Set default CORS headers for all responses
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

  const url = req.url;
  const method = req.method;
  const body = req.body || {};
  const query = req.query || {};

  try {
    // 1. HEALTH & STATUS
    if (url.includes('/health') || url.includes('/status')) {
      return res.status(200).json({
        status: 'ok',
        service: 'love-api',
        version: 'v2.2.0-production',
        timestamp: getQatarTime(),
        timezone: 'Asia/Qatar'
      });
    }

    // 2. PATIENT LOGIN (PERSISTENT RECORDS)
    if (url.includes('/patient/login') && method === 'POST') {
      const { personalId, gender, name } = body;
      if (!personalId) return res.status(400).json({ success: false, error: 'personalId is required' });
      
      // Check if patient exists
      let { data: patient, error: findError } = await supabase
        .from('patients')
        .select('*')
        .eq('personal_id', personalId)
        .single();

      if (findError && findError.code !== 'PGRST116') throw findError;

      if (!patient) {
        // Create new patient record
        const { data: newPatient, error: createError } = await supabase
          .from('patients')
          .insert({
            personal_id: personalId,
            gender: gender || 'male',
            name: name || `Patient ${personalId}`,
            created_at: getQatarTime()
          })
          .select()
          .single();
        if (createError) throw createError;
        patient = newPatient;
      }

      return res.status(200).json({
        success: true,
        data: patient
      });
    }

    // 3. QUEUE ENTER (WEIGHTED DYNAMIC START)
    if ((url.includes('/queue/enter') || url.includes('/queue/create')) && method === 'POST') {
      let clinic_id = body.clinic_id || body.clinicId;
      const patient_id = body.patient_id || body.patientId;
      const exam_type = body.exam_type || body.examType || 'general';
      const patient_name = body.patient_name || `Patient ${patient_id}`;
      const gender = body.gender || 'male';

      if (!patient_id) {
        return res.status(400).json({ success: false, error: 'patient_id is required' });
      }

      // If no clinic_id provided, find the least loaded clinic in the route (Weighted Start)
      if (!clinic_id) {
        const { route } = getNextClinicInRoute({ examType: exam_type, gender });
        if (route && route.length > 0) {
          // Get current waiting counts for all clinics in route
          const { data: counts } = await supabase
            .from('queues')
            .select('clinic_id')
            .in('clinic_id', route)
            .eq('queue_date', getTodayDate())
            .eq('status', QUEUE_STATUS.WAITING);
          
          const clinicLoads = route.map(cid => ({
            id: cid,
            count: (counts || []).filter(c => c.clinic_id === cid).length
          }));
          
          // Pick the one with minimum load
          clinic_id = clinicLoads.reduce((prev, curr) => prev.count <= curr.count ? prev : curr).id;
        }
      }

      if (!clinic_id) return res.status(400).json({ success: false, error: 'Could not determine clinic' });

      // Use RPC for atomic sequential numbering
      const { data, error } = await supabase.rpc('enter_unified_queue_v2', {
        p_clinic_id: clinic_id,
        p_patient_id: patient_id,
        p_patient_name: patient_name,
        p_exam_type: exam_type,
        p_date: getTodayDate()
      });

      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    // 4. QUEUE STATUS & STATS
    if (url.includes('/queue/status') || url.includes('/queue/stats')) {
      const clinicId = query.clinicId || query.clinic_id;
      if (!clinicId) return res.status(400).json({ success: false, error: 'clinicId is required' });

      const { data, error } = await supabase
        .from('queues')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('queue_date', getTodayDate())
        .order('display_number', { ascending: true });

      if (error) throw error;

      const stats = {
        total: data.length,
        waiting: data.filter(r => r.status === QUEUE_STATUS.WAITING).length,
        called: data.filter(r => r.status === QUEUE_STATUS.CALLED).length,
        serving: data.filter(r => r.status === QUEUE_STATUS.IN_PROGRESS).length,
        completed: data.filter(r => r.status === QUEUE_STATUS.DONE).length
      };

      return res.status(200).json({
        success: true,
        queue: data,
        stats: stats
      });
    }

    // 5. DOCTOR ACTION: CALL NEXT
    if (url.includes('/queue/call') && method === 'POST') {
      const clinicId = body.clinicId || body.clinic_id;
      if (!clinicId) return res.status(400).json({ success: false, error: 'clinicId is required' });

      const { data, error } = await supabase.rpc('call_next_patient_v2', {
        p_clinic_id: clinicId,
        p_date: getTodayDate()
      });

      if (error) throw error;
      if (!data) return res.status(200).json({ success: false, message: 'No patients waiting' });

      return res.status(200).json({ success: true, data });
    }

    // 6. DOCTOR ACTION: START EXAM
    if (url.includes('/queue/start') && method === 'POST') {
      const { queueId } = body;
      if (!queueId) return res.status(400).json({ success: false, error: 'queueId is required' });

      const { data, error } = await supabase
        .from('queues')
        .update({ 
          status: QUEUE_STATUS.IN_PROGRESS,
          started_at: getQatarTime()
        })
        .eq('id', queueId)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    // 7. DOCTOR ACTION: ADVANCE (DYNAMIC PATHWAY)
    if (url.includes('/queue/advance') && method === 'POST') {
      const { queueId, clinicId } = body;
      if (!queueId) return res.status(400).json({ success: false, error: 'queueId is required' });

      // 1. Get current queue record
      const { data: current, error: getError } = await supabase
        .from('queues')
        .select('*')
        .eq('id', queueId)
        .single();

      if (getError || !current) throw getError || new Error('Queue record not found');

      // 2. Mark current as DONE
      await supabase
        .from('queues')
        .update({ 
          status: QUEUE_STATUS.DONE,
          completed_at: getQatarTime()
        })
        .eq('id', queueId);

      // 3. Calculate next clinic
      const { nextClinicId, finished } = getNextClinicInRoute({
        examType: current.exam_type,
        gender: current.gender || 'male',
        currentClinicId: clinicId || current.clinic_id
      });

      // 4. If not finished, create new entry in next clinic
      let nextEntry = null;
      if (!finished && nextClinicId) {
        const { data: created, error: createError } = await supabase.rpc('enter_unified_queue_v2', {
          p_clinic_id: nextClinicId,
          p_patient_id: current.patient_id,
          p_patient_name: current.patient_name,
          p_exam_type: current.exam_type,
          p_date: getTodayDate()
        });
        if (!createError) nextEntry = created;
      }

      return res.status(200).json({ 
        success: true, 
        finished, 
        nextClinicId,
        nextEntry
      });
    }

    // 8. DOCTOR ACTION: DONE (FINAL)
    if (url.includes('/queue/done') && method === 'POST') {
      const { queueId } = body;
      if (!queueId) return res.status(400).json({ success: false, error: 'queueId is required' });

      const { data, error } = await supabase
        .from('queues')
        .update({ 
          status: QUEUE_STATUS.DONE,
          completed_at: getQatarTime()
        })
        .eq('id', queueId)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    // 9. CLINICS LIST
    if (url.includes('/clinics') && method === 'GET') {
      const { data, error } = await supabase
        .from('clinics')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    // 10. ADMIN LOGIN
    if (url.includes('/admin/login') && method === 'POST') {
      const { username, password } = body;
      // Basic check - in production use proper auth
      if (username === 'admin' && password === 'password') {
        return res.status(200).json({
          success: true,
          token: 'admin-token-' + Date.now(),
          expiresAt: new Date(Date.now() + 86400000).toISOString()
        });
      }
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    return res.status(404).json({ success: false, error: 'Endpoint not found' });

  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error',
      code: err.code
    });
  }
}
