import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function reply(res, status, payload) {
  return res.status(status).json(payload);
}

function normalizeQuery(query = {}) {
  return {
    ...query,
    patient_id: query.patient_id || query.patientId || null,
    clinic_id: query.clinic_id || query.clinicId || null,
    route_id: query.route_id || query.routeId || null,
  };
}

function normalizeBody(body = {}) {
  return {
    ...body,
    patient_id: body.patient_id || body.patientId || null,
    clinic_id: body.clinic_id || body.clinicId || null,
    route_id: body.route_id || body.routeId || null,
  };
}

export async function getQueuePosition(req, res) {
  const query = normalizeQuery(Object.fromEntries(new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams));
  const clinicId = query.clinic_id;
  const patientId = query.patient_id;

  if (!clinicId || !patientId) {
    return reply(res, 400, { success: false, error: 'clinic_id and patient_id required' });
  }

  const { data: queueRows, error } = await sb
    .from('queues')
    .select('*')
    .eq('clinic_id', clinicId)
    .in('status', ['waiting', 'calling'])
    .order('queue_number_int', { ascending: true });

  if (error) return reply(res, 500, { success: false, error: error.message });

  const rows = queueRows || [];
  const currentIndex = rows.findIndex((q) => String(q.patient_id) === String(patientId));

  return reply(res, 200, {
    success: true,
    queue_position: currentIndex >= 0 ? currentIndex + 1 : null,
    total_waiting: rows.length,
    queue: rows,
  });
}

export async function createRoute(req, res) {
  const body = normalizeBody(req.body || {});
  const { patient_id, exam_type, gender, stations } = body;

  if (!patient_id || !Array.isArray(stations) || stations.length === 0) {
    return reply(res, 400, { success: false, error: 'invalid route payload' });
  }

  const { data, error } = await sb
    .from('patient_routes')
    .insert({
      patient_id,
      exam_type: exam_type || null,
      gender: gender || null,
      stations,
      current_station_index: 0,
      status: 'active',
    })
    .select()
    .single();

  if (error) return reply(res, 500, { success: false, error: error.message });

  return reply(res, 200, { success: true, route: data });
}

export async function getRoute(req, res) {
  const query = normalizeQuery(Object.fromEntries(new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams));
  const patientId = query.patient_id;
  const routeId = query.route_id;

  if (!patientId && !routeId) {
    return reply(res, 400, { success: false, error: 'patient_id or route_id required' });
  }

  let request = sb.from('patient_routes').select('*');
  if (routeId) request = request.eq('id', routeId);
  else request = request.eq('patient_id', patientId).order('created_at', { ascending: false }).limit(1);

  const { data, error } = await request.maybeSingle();
  if (error) return reply(res, 404, { success: false, error: error.message });
  if (!data) return reply(res, 404, { success: false, error: 'route not found' });

  return reply(res, 200, { success: true, route: data });
}

export async function callNextPatient(req, res) {
  const body = normalizeBody(req.body || {});
  const clinicId = body.clinic_id;

  if (!clinicId) return reply(res, 400, { success: false, error: 'clinic_id required' });

  const { data: nextPatient, error: fetchError } = await sb
    .from('queues')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('status', 'waiting')
    .order('queue_number_int', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchError) return reply(res, 500, { success: false, error: fetchError.message });
  if (!nextPatient) return reply(res, 404, { success: false, error: 'no waiting patients' });

  const { data, error } = await sb
    .from('queues')
    .update({ status: 'calling', called_at: new Date().toISOString() })
    .eq('id', nextPatient.id)
    .select()
    .single();

  if (error) return reply(res, 500, { success: false, error: error.message });

  return reply(res, 200, { success: true, patient: data });
}

export async function advanceRoute(req, res) {
  const body = normalizeBody(req.body || {});
  const routeId = body.route_id;

  if (!routeId) return reply(res, 400, { success: false, error: 'route_id required' });

  const { data: route, error: routeError } = await sb
    .from('patient_routes')
    .select('*')
    .eq('id', routeId)
    .maybeSingle();

  if (routeError) return reply(res, 500, { success: false, error: routeError.message });
  if (!route) return reply(res, 404, { success: false, error: 'route not found' });

  const currentIndex = Number(route.current_station_index || 0);
  const totalStations = Array.isArray(route.stations) ? route.stations.length : 0;
  const nextIndex = currentIndex + 1;
  const completed = nextIndex >= totalStations;

  const { data, error } = await sb
    .from('patient_routes')
    .update({
      current_station_index: completed ? currentIndex : nextIndex,
      status: completed ? 'completed' : 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', routeId)
    .select()
    .single();

  if (error) return reply(res, 500, { success: false, error: error.message });

  return reply(res, 200, { success: true, route: data });
}
