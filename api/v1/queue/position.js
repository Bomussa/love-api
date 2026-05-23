import { sb, reply, normalizeQuery } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return reply(res, 405, { success: false, error: 'Method not allowed' });
  }

  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const query = normalizeQuery(Object.fromEntries(parsed.searchParams));

  const clinicId = query.clinic_id;
  const patientId = query.patient_id;

  if (!clinicId || !patientId) {
    return reply(res, 400, {
      success: false,
      error: 'clinic_id and patient_id required',
    });
  }

  const { data, error } = await sb
    .from('queues')
    .select('*')
    .eq('clinic_id', clinicId)
    .in('status', ['waiting', 'calling'])
    .order('queue_number_int', { ascending: true });

  if (error) {
    return reply(res, 500, {
      success: false,
      error: error.message,
    });
  }

  const rows = data || [];
  const index = rows.findIndex((row) => String(row.patient_id) === String(patientId));

  return reply(res, 200, {
    success: true,
    queue_position: index >= 0 ? index + 1 : null,
    total_waiting: rows.length,
    queue: rows,
  });
}
