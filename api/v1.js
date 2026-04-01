import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

function getSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = getSupabaseClient();
  const { method, url } = req;
  const parsedUrl = new URL(url, `https://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams);
  
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  try {
    if (pathname === '/api/v1/health') {
      return res.status(200).json({ success: true, status: 'ok', version: '5.0.0', pin_system: 'REMOVED' });
    }

    if (pathname === '/api/v1/clinics' && method === 'GET') {
      const { data } = await supabase.from('clinics').select('*').order('name_ar');
      return res.status(200).json({ success: true, data });
    }

    if (pathname === '/api/v1/queue/create' && method === 'POST') {
      const { patientId, examType, gender, path } = body;
      const { data, error } = await supabase.rpc('fn_create_queue_atomic', {
        p_patient_id: patientId,
        p_exam_type: examType,
        p_gender: gender,
        p_path: path || []
      });
      if (error) return res.status(400).json({ success: false, error: error.message });
      return res.status(200).json({ success: true, data });
    }

    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      const { queueId, patientId, clinicId } = query;
      if (clinicId) {
        const { count } = await supabase.from('queues').select('*', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('status', 'WAITING');
        return res.status(200).json({ success: true, data: { waitingCount: count } });
      }
      const { data } = await supabase.from('queues').select('*').or(`id.eq.${queueId},patient_id.eq.${patientId}`).neq('status', 'DONE').maybeSingle();
      return res.status(200).json({ success: true, data });
    }

    if (pathname === '/api/v1/queue/advance' && method === 'POST') {
      const { queueId, doctorClinicId, version } = body;
      const { data, error } = await supabase.rpc('fn_advance_queue', {
        p_queue_id: queueId,
        p_doctor_clinic: doctorClinicId,
        p_client_version: version
      });
      if (error) return res.status(400).json({ success: false, error: error.message });
      return res.status(200).json({ success: true, data });
    }

    return res.status(404).json({ success: false, error: 'Not Found' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
