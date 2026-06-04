import { createClient } from '@supabase/supabase-js';
import { CLINIC_FLOW } from '../lib/constants.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { method, url } = req;
    const parsedUrl = new URL(url, `http://${req.headers.host}`);
    const path = parsedUrl.pathname;

    // =========================
    // HEALTH
    // =========================
    if (path === '/api/v1/health') {
      return res.json({ success: true, status: 'online' });
    }

    // =========================
    // PATIENT LOGIN
    // =========================
    if (path === '/api/v1/patient/login' && method === 'POST') {
      const body = req.body;
      const flowKey = `${body.examType || 'recruitment'}_${body.gender || 'male'}`;
      const flow = CLINIC_FLOW[flowKey];

      if (!flow) {
        return res.status(400).json({ error: 'Invalid flow' });
      }

      return res.json({
        success: true,
        data: {
          patient_id: body.personalId,
          flow
        }
      });
    }

    // =========================
    // CREATE QUEUE
    // =========================
    if (path === '/api/v1/queue/create' && method === 'POST') {
      const body = req.body;

      const { data, error } = await supabase
        .from('queues')
        .insert([{
          patient_id: body.patient_id,
          clinic_id: body.clinic_id,
          status: 'waiting'
        }])
        .select();

      if (error) throw error;

      return res.json({ success: true, data });
    }

    // =========================
    // STATUS
    // =========================
    if (path === '/api/v1/queue/status' && method === 'GET') {
      const clinic_id = parsedUrl.searchParams.get('clinic_id');

      if (!clinic_id) {
        return res.status(400).json({ error: 'clinic_id required' });
      }

      const { data, error } = await supabase
        .from('queues')
        .select('*')
        .eq('clinic_id', clinic_id)
        .order('created_at');

      if (error) throw error;

      return res.json({ success: true, data });
    }

    // =========================
    // CALL NEXT
    // =========================
    if (path === '/api/v1/queue/call' && method === 'POST') {
      const { clinic_id } = req.body;

      const { data } = await supabase
        .from('queues')
        .select('*')
        .eq('clinic_id', clinic_id)
        .eq('status', 'waiting')
        .order('created_at')
        .limit(1)
        .single();

      if (!data) return res.json({ success: false, message: 'No patients in queue' });

      await supabase
        .from('queues')
        .update({ status: 'called' })
        .eq('id', data.id);

      return res.json({ success: true, data });
    }

    // =========================
    // DONE
    // =========================
    if (path === '/api/v1/queue/done' && method === 'POST') {
      const { id } = req.body;

      await supabase
        .from('queues')
        .update({ status: 'done' })
        .eq('id', id);

      return res.json({ success: true });
    }

    return res.status(404).json({ error: 'Not found' });

  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({
      error: err.message
    });
  }
}
