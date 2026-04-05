/**
 * API v2 - Queue endpoints
 * PIN endpoints are intentionally removed.
 */

import { createClient } from '@supabase/supabase-js';

export const QUEUE_STATUS = {
  WAITING: 'WAITING',
  CALLED: 'CALLED',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
};

export function createSupabaseClient(env = process.env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;

  if (!url || !key) {
    throw new Error('Supabase environment is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY)');
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function invokeRpcSafe(supabase, fnName, params) {
  const { data, error } = await supabase.rpc(fnName, params);
  if (!error) {
    return { ok: true, data };
  }

  if (error.code === '42883') {
    return { ok: false, missing: true, error };
  }

  throw new Error(`RPC ${fnName} failed: ${error.message}`);
}

export async function handleEnterQueue(body, res, supabase) {
  const { clinicId, patientId, patientName, examType } = body || {};
  if (!clinicId || !patientId) {
    return res.status(400).json({ success: false, error: 'clinicId and patientId are required' });
  }

  const rpc = await invokeRpcSafe(supabase, 'enter_queue_safe', {
    p_clinic_id: String(clinicId),
    p_patient_id: String(patientId),
    p_patient_name: patientName ? String(patientName) : null,
    p_exam_type: examType ? String(examType) : null,
  });

  if (rpc.ok) return res.status(200).json({ success: true, data: rpc.data, via: 'rpc' });

  const today = new Date().toISOString().split('T')[0];
  const { data: maxRow, error: maxErr } = await supabase
    .from('queues').select('display_number').eq('clinic_id', clinicId).eq('queue_date', today)
    .order('display_number', { ascending: false }).limit(1).maybeSingle();
  if (maxErr) throw maxErr;

  const displayNumber = (maxRow?.display_number || 0) + 1;
  const { data: inserted, error: insertErr } = await supabase
    .from('queues')
    .insert({ clinic_id: clinicId, patient_id: String(patientId), patient_name: patientName ? String(patientName) : null, exam_type: examType ? String(examType) : null, queue_date: today, display_number: displayNumber, status: QUEUE_STATUS.WAITING, entered_at: new Date().toISOString() })
    .select('*').single();

  if (insertErr) throw insertErr;
  return res.status(200).json({ success: true, data: inserted, via: 'fallback' });
}

export async function handleCallNext(body, res, supabase) {
  const { clinicId } = body || {};
  if (!clinicId) return res.status(400).json({ success: false, error: 'clinicId required' });

  const rpc = await invokeRpcSafe(supabase, 'call_next_patient_v2', { p_clinic_id: String(clinicId) });
  if (rpc.ok) return res.status(200).json({ success: true, data: rpc.data, via: 'rpc' });

  const today = new Date().toISOString().split('T')[0];
  const { data: next, error: nextErr } = await supabase
    .from('queues').select('*').eq('clinic_id', clinicId).eq('queue_date', today).eq('status', QUEUE_STATUS.WAITING)
    .order('display_number', { ascending: true }).limit(1).maybeSingle();

  if (nextErr) throw nextErr;
  if (!next) return res.status(200).json({ success: true, data: null, message: 'Queue empty' });

  const { data: updated, error: updateErr } = await supabase
    .from('queues').update({ status: QUEUE_STATUS.CALLED, called_at: new Date().toISOString() }).eq('id', next.id).select('*').single();

  if (updateErr) throw updateErr;
  return res.status(200).json({ success: true, data: updated, via: 'fallback' });
}

export async function handleQueueDone(body, res, supabase) {
  const { clinicId, patientId } = body || {};
  if (!clinicId || !patientId) {
    return res.status(400).json({ success: false, error: 'clinicId and patientId required' });
  }

  const { error } = await supabase.from('queues').update({ status: QUEUE_STATUS.DONE, completed_at: new Date().toISOString() }).match({ clinic_id: clinicId, patient_id: patientId, status: QUEUE_STATUS.CALLED });
  if (error) throw error;
  return res.status(200).json({ success: true, message: 'تم إكمال الفحص بنجاح' });
}

export async function handleGetStatus(clinicId, res, supabase) {
  if (!clinicId) return res.status(400).json({ success: false, error: 'clinicId required' });
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase.from('queues').select('*').eq('clinic_id', clinicId).eq('queue_date', today).order('display_number', { ascending: true });
  if (error) throw error;
  return res.status(200).json({ success: true, queue: data });
}

export default async function handler(req, res) {
  const { method, query, body } = req;
  const endpoint = query.endpoint;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') return res.status(200).end();

  let supabase;
  try {
    supabase = createSupabaseClient();
  } catch (e) {
    return res.status(503).json({ success: false, error: e.message });
  }

  try {
    switch (endpoint) {
      case 'queue/enter': return await handleEnterQueue(body, res, supabase);
      case 'queue/call-next': return await handleCallNext(body, res, supabase);
      case 'queue/done': return await handleQueueDone(body, res, supabase);
      case 'queue/status': return await handleGetStatus(query.clinicId, res, supabase);
      case 'pins/verify':
      case 'pins/generate':
        return res.status(410).json({ success: false, error: 'PIN system permanently removed', code: 'PIN_REMOVED' });
      default:
        return res.status(404).json({ success: false, error: 'Endpoint not found' });
    }
  } catch (error) {
    console.error(`[API V2 Error] ${endpoint}:`, error);
    return res.status(500).json({ success: false, error: 'Internal Server Error', details: error.message });
  }
}
