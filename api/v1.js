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
// CONSTANTS & UTILITIES
// ============================================================================

export const QUEUE_STATUS = {
  WAITING: "waiting",
  CALLED: "called",
  IN_PROGRESS: "serving",
  DONE: "done",
};

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
  const ROUTES = {
    'recruitment:male': ['BIO', 'ECG', 'AUD', 'XR', 'EYE', 'ENT', 'DNT', 'LAB'],
    'recruitment:female': ['BIO', 'ECG', 'AUD', 'XR', 'EYE', 'ENT', 'DNT', 'LAB'],
    'general:male': ['BIO', 'XR', 'EYE'],
    'general:female': ['BIO', 'XR', 'EYE'],
  };
  const route = ROUTES[routeKey] || [];
  if (!route.length) return { nextClinicId: null, finished: true, route: [] };
  const idx = route.indexOf(currentClinicId);
  if (idx === -1) return { nextClinicId: route[0] || null, finished: false, route };
  const nextClinicId = route[idx + 1] || null;
  return { nextClinicId, finished: !nextClinicId, route };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).set(corsHeaders).end();
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

  const url = req.url;
  const method = req.method;
  const body = req.body || {};
  const query = req.query || {};

  try {
    // 1. HEALTH
    if (url.includes('/health') || url.includes('/status')) {
      return res.status(200).json({ status: 'ok', version: 'v3.1.0', timestamp: getQatarTime() });
    }

    // 2. PATIENT LOGIN
    if (url.includes('/patient/login') && method === 'POST') {
      const { personalId, gender, examType } = body;
      if (!personalId) return res.status(400).json({ success: false, error: 'personalId is required' });
      
      let { data: patient, error: findError } = await supabase.from('patients').select('*').eq('personal_id', personalId).single();
      if (findError && findError.code !== 'PGRST116') throw findError;

      if (!patient) {
        const { data: newPatient, error: createError } = await supabase.from('patients').insert({
          personal_id: personalId,
          gender: gender || 'male',
          name: `Patient ${personalId}`,
          created_at: getQatarTime()
        }).select().single();
        if (createError) throw createError;
        patient = newPatient;
      }

      const { data: activeQueue } = await supabase.from('queues').select('*').eq('patient_id', personalId).eq('queue_date', getTodayDate()).neq('status', 'done').order('created_at', { ascending: false }).limit(1).single();
      return res.status(200).json({ success: true, data: { ...patient, activeQueue } });
    }

    // 3. QUEUE ENTER
    if (url.includes('/queue/enter') && method === 'POST') {
      let { clinicId, patientId, examType, gender } = body;
      if (!patientId) return res.status(400).json({ success: false, error: 'patientId is required' });

      if (!clinicId) {
        const { route } = getNextClinicInRoute({ examType, gender });
        if (route && route.length > 0) {
          const { data: counts } = await supabase.from('queues').select('clinic_id').in('clinic_id', route).eq('queue_date', getTodayDate()).eq('status', 'waiting');
          const clinicLoads = route.map(cid => ({ id: cid, count: (counts || []).filter(c => c.clinic_id === cid).length }));
          clinicId = clinicLoads.reduce((prev, curr) => prev.count <= curr.count ? prev : curr).id;
        }
      }

      const { data, error } = await supabase.rpc('enter_unified_queue', {
        p_patient_id: patientId,
        p_clinic_id: clinicId,
        p_patient_name: `Patient ${patientId}`,
        p_exam_type: examType || 'general'
      });
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    // 4. QUEUE STATUS
    if (url.includes('/queue/status')) {
      const clinicId = query.clinicId || query.clinic_id;
      const patientId = query.patientId || query.patient_id;
      let queryBuilder = supabase.from('queues').select('*').eq('queue_date', getTodayDate());
      if (clinicId) queryBuilder = queryBuilder.eq('clinic_id', clinicId);
      if (patientId) queryBuilder = queryBuilder.eq('patient_id', patientId);
      const { data, error } = await queryBuilder.order('display_number', { ascending: true });
      if (error) throw error;
      const stats = clinicId ? {
        total: data.length,
        waiting: data.filter(r => r.status === 'waiting').length,
        serving: data.filter(r => r.status === 'serving' || r.status === 'called').length,
        completed: data.filter(r => r.status === 'done').length
      } : null;
      return res.status(200).json({ success: true, queue: data, stats });
    }

    // 5. DOCTOR ACTION: CALL NEXT
    if (url.includes('/queue/call') && method === 'POST') {
      const { clinicId } = body;
      const { data, error } = await supabase.rpc('call_next_patient', { p_clinic_id: clinicId });
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    // 6. DOCTOR ACTION: START EXAM
    if (url.includes('/queue/start') && method === 'POST') {
      const { queueId } = body;
      const { data, error } = await supabase.from('queues').update({ status: 'serving', started_at: getQatarTime() }).eq('id', queueId).select().single();
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    // 7. DOCTOR ACTION: ADVANCE
    if (url.includes('/queue/advance') && method === 'POST') {
      const { queueId, clinicId } = body;
      const { data: current } = await supabase.from('queues').select('*').eq('id', queueId).single();
      if (!current) return res.status(404).json({ success: false, error: 'Not found' });
      await supabase.from('queues').update({ status: 'done', completed_at: getQatarTime() }).eq('id', queueId);
      const { nextClinicId, finished } = getNextClinicInRoute({ examType: current.exam_type, gender: current.gender || 'male', currentClinicId: clinicId || current.clinic_id });
      if (!finished && nextClinicId) {
        await supabase.rpc('enter_unified_queue', { p_patient_id: current.patient_id, p_clinic_id: nextClinicId, p_patient_name: current.patient_name, p_exam_type: current.exam_type });
      }
      return res.status(200).json({ success: true, finished, nextClinicId });
    }

    // 8. ADMIN LOGIN
    if (url.includes('/admin/login') && method === 'POST') {
      const { username, password } = body;
      const { data: user, error } = await supabase.from('admin_users').select('*').eq('username', username).eq('password', password).eq('is_active', true).single();
      if (error || !user) return res.status(401).json({ success: false, error: 'Invalid credentials' });
      return res.status(200).json({ success: true, user: { id: user.id, username: user.username, role: user.role, name: user.name } });
    }

    // 9. CLINICS LIST
    if (url.includes('/clinics') && method === 'GET') {
      const { data, error } = await supabase.from('clinics').select('*').eq('is_active', true).order('name');
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    return res.status(404).json({ success: false, error: 'Not found' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
