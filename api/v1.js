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

export default async function handler(req, res) {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).set(corsHeaders).end();
  }

  const url = req.url;
  const method = req.method;
  const body = req.body || {};

  try {
    // 1. HEALTH & STATUS
    if (url.includes('/health') || url.includes('/status')) {
      return res.status(200).json({
        status: 'ok',
        service: 'love-api',
        version: 'v1.1.0',
        timestamp: new Date().toISOString(),
        timezone: 'Asia/Qatar'
      });
    }

    // 2. PATIENT LOGIN
    if (url.includes('/patient/login') && method === 'POST') {
      const { personalId, gender } = body;
      // In a real app, you'd verify against a patients table
      // For now, we return success to allow entry
      return res.status(200).json({
        success: true,
        data: { id: personalId, gender, name: `Patient ${personalId}` }
      });
    }

    // 3. QUEUE ENTER (The core fix)
    if (url.includes('/queue/enter') && method === 'POST') {
      const clinic_id = body.clinic_id || body.clinicId;
      const patient_id = body.patient_id || body.patientId;
      const exam_type = body.exam_type || body.examType || 'general';
      const patient_name = body.patient_name || `Patient ${patient_id}`;

      if (!clinic_id || !patient_id) {
        return res.status(400).json({ success: false, error: 'clinic_id and patient_id are required' });
      }

      // Call the Supabase RPC for safe queue entry
      const { data, error } = await supabase.rpc('enter_unified_queue_safe', {
        p_clinic_id: clinic_id,
        p_patient_id: patient_id,
        p_patient_name: patient_name,
        p_exam_type: exam_type
      });

      if (error) throw error;

      return res.status(200).json({
        success: true,
        data: {
          clinic_id: data.clinic,
          patient_id: data.user,
          position: data.number,
          status: data.status,
          message: data.message || 'Entered queue successfully'
        }
      });
    }

    // 4. QUEUE STATUS
    if (url.includes('/queue/status')) {
      const parts = url.split('/');
      const id = parts[parts.length - 1].split('?')[0];
      const clinic_id = req.query.clinic_id;

      let query = supabase.from('queues').select('*');
      
      if (clinic_id) {
        query = query.eq('clinic_id', clinic_id);
      }
      
      if (id && id !== 'status') {
        query = query.or(`id.eq.${id},patient_id.eq.${id}`);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      return res.status(200).json({
        success: true,
        queue: data,
        stats: {
          totalWaiting: data.filter(r => r.status === 'waiting').length,
          totalIn: data.filter(r => ['called', 'serving'].includes(r.status)).length,
          totalDone: data.filter(r => r.status === 'completed').length
        }
      });
    }

    // 5. DOCTOR CONTROLS (Call Next)
    if (url.includes('/queue/call') && method === 'POST') {
      const { clinicId } = body;
      const { data, error } = await supabase.rpc('call_next_patient', {
        p_clinic_id: clinicId
      });

      if (error) throw error;

      return res.status(200).json({ success: true, data });
    }

    // 6. DOCTOR CONTROLS (Done)
    if (url.includes('/queue/done') && method === 'POST') {
      const { clinicId, patientId } = body;
      const { data, error } = await supabase
        .from('queues')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .eq('status', 'serving')
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({ success: true, data });
    }

    // 7. CLINICS
    if (url.includes('/clinics') && method === 'GET') {
      const { data, error } = await supabase.from('clinics').select('*').eq('is_active', true);
      if (error) throw error;
      return res.status(200).json(data);
    }

    // Default 404
    return res.status(404).json({
      error: 'Endpoint not found',
      path: url
    });

  } catch (err) {
    console.error(`[API Error] ${url}:`, err);
    return res.status(500).json({ 
      success: false, 
      error: err.message,
      details: err.details || null
    });
  }
}
