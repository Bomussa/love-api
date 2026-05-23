import { sb, reply, normalizeBody } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return reply(res, 405, { success: false, error: 'Method not allowed' });
  }

  const body = normalizeBody(req.body || {});
  const { patient_id, exam_type, gender, stations } = body;

  if (!patient_id || !Array.isArray(stations) || stations.length === 0) {
    return reply(res, 400, {
      success: false,
      error: 'invalid route payload',
    });
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

  if (error) {
    return reply(res, 500, {
      success: false,
      error: error.message,
    });
  }

  return reply(res, 200, {
    success: true,
    route: data,
  });
}
