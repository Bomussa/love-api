import { createClient } from '@supabase/supabase-js';
import { CLINIC_FLOW } from '../lib/constants.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// Cache for status to reduce DB load
const statusCache = new Map();
const CACHE_TTL = 2000; // 2 seconds

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { method, url } = req;
    const parsedUrl = new URL(url, `http://${req.headers.host}`);
    const path = parsedUrl.pathname;

    // =========================
    // HEALTH
    // =========================
    if (path === '/api/v1/health') {
      return res.json({ success: true });
    }

    // =========================
    // REALTIME (SSE)
    // =========================
    if (path === '/api/v1/queue/stream' && method === 'GET') {
      const clinic_id = parsedUrl.searchParams.get('clinic_id');
      if (!clinic_id) return res.status(400).json({ error: 'clinic_id required' });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const sendUpdate = async () => {
        const { data } = await supabase
          .from('queues')
          .select('*')
          .eq('clinic_id', clinic_id)
          .order('created_at');
        res.write(`data: ${JSON.stringify({ success: true, data })}\n\n`);
      };

      await sendUpdate();
      const interval = setInterval(sendUpdate, 3000);

      req.on('close', () => clearInterval(interval));
      return;
    }

    // =========================
    // PATIENT LOGIN
    // =========================
    if (path === '/api/v1/patient/login' && method === 'POST') {
      const body = req.body;

      const flow = CLINIC_FLOW[`${body.examType}_${body.gender}`];

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
      const patient_id = parsedUrl.searchParams.get('patient_id');

      if (!clinic_id) {
        return res.status(400).json({ error: 'clinic_id required' });
      }

      // Check cache
      const cacheKey = `status_${clinic_id}`;
      const cached = statusCache.get(cacheKey);
      if (cached && (Date.now() - cached.time < CACHE_TTL)) {
        return res.json({ success: true, data: cached.data, fromCache: true });
      }

      const { data, error } = await supabase
        .from('queues')
        .select('*')
        .eq('clinic_id', clinic_id)
        .order('created_at');

      if (error) throw error;

      // Update cache
      statusCache.set(cacheKey, { data, time: Date.now() });

      let notification = null;
      if (patient_id) {
        const waitingList = data.filter(q => q.status === 'waiting');
        const index = waitingList.findIndex(q => q.patient_id === patient_id);
        const entry = data.find(q => q.patient_id === patient_id);

        if (entry?.status === 'called') {
          notification = 'YOUR_TURN';
        } else if (index === 0 || index === 1) {
          notification = 'NEAR_TURN';
        }
      }

      return res.json({ success: true, data, notification });
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

      if (!data) return res.json({ success: false });

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
    return res.status(500).json({
      error: err.message
    });
  }
}
