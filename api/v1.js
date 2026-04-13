// ============================================================================
// MMC-MMS API v1 — تصحيح كلاود
// مصدر الحقيقة الوحيد: Supabase (unified_queue)
// ============================================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

function getQatarTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Qatar' })).toISOString();
}
function getTodayDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Qatar' });
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).set(corsHeaders).end();
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  const url = req.url || '';
  const method = req.method;
  const body = req.body || {};
  const query = req.query || {};

  try {
    // ── 1. HEALTH ────────────────────────────────────────────────────────────
    if (url.includes('/health') || url.includes('/status')) {
      const { data: clinics } = await supabase.from('clinics').select('count').limit(1);
      return res.status(200).json({
        status: 'ok', version: 'v4.0.0-claude-fix',
        timestamp: getQatarTime(), supabase: 'connected'
      });
    }

    // ── 2. PATIENT LOGIN ─────────────────────────────────────────────────────
    if (url.includes('/patient/login') && method === 'POST') {
      const { personalId, gender, examType } = body;
      if (!personalId) return res.status(400).json({ success: false, error: 'personalId is required' });

      let { data: patient, error: findError } = await supabase
        .from('patients').select('*').eq('personal_id', personalId).maybeSingle();

      if (findError) throw findError;

      if (!patient) {
        const { data: newPatient, error: createError } = await supabase
          .from('patients')
          .insert({ personal_id: personalId, gender: gender || 'male', name: `Patient ${personalId}`, patient_id: personalId })
          .select().single();
        if (createError) throw createError;
        patient = newPatient;
      } else {
        await supabase.from('patients').update({ updated_at: getQatarTime() }).eq('id', patient.id);
      }

      const { data: activeQueue } = await supabase
        .from('unified_queue')
        .select('*')
        .eq('patient_id', personalId)
        .eq('queue_date', getTodayDate())
        .not('status', 'in', '("completed","cancelled","no_show","done")')
        .order('entered_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return res.status(200).json({ success: true, data: { ...patient, activeQueue } });
    }

    // ── 3. QUEUE ENTER ───────────────────────────────────────────────────────
    if ((url.includes('/queue/enter') || url.includes('/queue/create')) && method === 'POST') {
      const clinic_id = body.clinic_id || body.clinicId;
      const patient_id = body.patient_id || body.patientId;
      const exam_type = body.exam_type || body.examType || 'general';
      const patient_name = body.patient_name || body.patientName || `Patient ${patient_id}`;

      if (!patient_id) return res.status(400).json({ success: false, error: 'patient_id is required' });
      if (!clinic_id) return res.status(400).json({ success: false, error: 'clinic_id is required' });

      // استخدام enter_unified_queue_safe (الموجودة فعلياً في Supabase)
      const { data, error } = await supabase.rpc('enter_unified_queue_safe', {
        p_clinic_id: clinic_id,
        p_patient_id: patient_id,
        p_patient_name: patient_name,
        p_exam_type: exam_type,
      });

      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    // ── 4. QUEUE STATUS ──────────────────────────────────────────────────────
    if ((url.includes('/queue/status') || url.includes('/queue/stats')) && method === 'GET') {
      const clinicId = query.clinicId || query.clinic_id;
      const patientId = query.patientId || query.patient_id;

      let q = supabase.from('unified_queue').select('*').eq('queue_date', getTodayDate());
      if (clinicId) q = q.eq('clinic_id', clinicId);
      if (patientId) q = q.eq('patient_id', patientId);

      const { data, error } = await q.order('display_number', { ascending: true });
      if (error) throw error;

      const stats = {
        total: data.length,
        waiting: data.filter(r => r.status === 'waiting').length,
        called: data.filter(r => r.status === 'called').length,
        serving: data.filter(r => ['serving','in_progress','in_service'].includes(r.status)).length,
        completed: data.filter(r => ['completed','done'].includes(r.status)).length,
        cancelled: data.filter(r => ['cancelled','no_show'].includes(r.status)).length,
      };

      return res.status(200).json({ success: true, queue: data, stats });
    }

    // ── 5. QUEUE POSITION (للمريض) ───────────────────────────────────────────
    if (url.includes('/queue/position') && method === 'GET') {
      const patientId = query.patientId || query.patient_id;
      const clinicId = query.clinicId || query.clinic_id;

      const { data: myEntry } = await supabase
        .from('unified_queue')
        .select('*')
        .eq('patient_id', patientId)
        .eq('queue_date', getTodayDate())
        .not('status', 'in', '("completed","cancelled","no_show")')
        .maybeSingle();

      if (!myEntry) return res.status(200).json({ success: true, position: null, entry: null });

      const { count } = await supabase
        .from('unified_queue')
        .select('*', { count: 'exact', head: true })
        .eq('clinic_id', myEntry.clinic_id)
        .eq('queue_date', getTodayDate())
        .eq('status', 'waiting')
        .lt('display_number', myEntry.display_number);

      return res.status(200).json({ success: true, position: (count || 0) + 1, entry: myEntry });
    }

    // ── 6. DOCTOR: START EXAM ────────────────────────────────────────────────
    if (url.includes('/queue/start') && method === 'POST') {
      const { queueId } = body;
      if (!queueId) return res.status(400).json({ success: false, error: 'queueId required' });
      const { data, error } = await supabase
        .from('unified_queue')
        .update({ status: 'in_progress', called_at: getQatarTime() })
        .eq('id', queueId).select().single();
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    // ── 7. DOCTOR: COMPLETE / ADVANCE ────────────────────────────────────────
    if (url.includes('/queue/complete') && method === 'POST') {
      const { queueId } = body;
      if (!queueId) return res.status(400).json({ success: false, error: 'queueId required' });
      const { data, error } = await supabase
        .from('unified_queue')
        .update({ status: 'completed', completed_at: getQatarTime() })
        .eq('id', queueId).select().single();
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    // ── 8. DOCTOR: CALL NEXT ─────────────────────────────────────────────────
    if (url.includes('/queue/call-next') && method === 'POST') {
      const { clinicId } = body;
      if (!clinicId) return res.status(400).json({ success: false, error: 'clinicId required' });

      // استخدام دالة call_next_patient_v2 الموجودة
      const { data, error } = await supabase.rpc('call_next_patient_v2', { p_clinic_id: clinicId });
      if (error) {
        // fallback manual
        const { data: next } = await supabase
          .from('unified_queue')
          .select('*').eq('clinic_id', clinicId)
          .eq('queue_date', getTodayDate())
          .eq('status', 'waiting')
          .order('display_number', { ascending: true })
          .limit(1).maybeSingle();
        if (!next) return res.status(200).json({ success: true, data: null, message: 'no_waiting' });
        const { data: called } = await supabase
          .from('unified_queue')
          .update({ status: 'called', called_at: getQatarTime() })
          .eq('id', next.id).select().single();
        return res.status(200).json({ success: true, data: called });
      }
      return res.status(200).json({ success: true, data });
    }

    // ── 9. CLINICS ────────────────────────────────────────────────────────────
    if (url.includes('/clinics') && method === 'GET') {
      const { data, error } = await supabase
        .from('clinics').select('*').eq('is_active', true).order('name_ar');
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    // ── 10. SETTINGS ──────────────────────────────────────────────────────────
    if (url.includes('/settings') && method === 'GET') {
      const { data, error } = await supabase.from('settings').select('*');
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    // ── 11. QUEUE CANCEL ──────────────────────────────────────────────────────
    if (url.includes('/queue/cancel') && method === 'POST') {
      const { queueId, patientId } = body;
      let q = supabase.from('unified_queue').update({ status: 'cancelled', cancelled_at: getQatarTime() });
      if (queueId) q = q.eq('id', queueId);
      else if (patientId) q = q.eq('patient_id', patientId).eq('queue_date', getTodayDate());
      else return res.status(400).json({ success: false, error: 'queueId or patientId required' });
      const { error } = await q;
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(404).json({ success: false, error: 'Endpoint not found', url });

  } catch (err) {
    console.error('[API Error]', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal error' });
  }
}
