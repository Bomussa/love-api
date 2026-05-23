import { sb, reply, normalizeBody } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return reply(res, 405, { success: false, error: 'Method not allowed' });
  }

  const body = normalizeBody(req.body || {});
  const clinicId = body.clinic_id;

  if (!clinicId) {
    return reply(res, 400, {
      success: false,
      error: 'clinic_id required',
    });
  }

  const { data: nextPatient, error: fetchError } = await sb
    .from('queues')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('status', 'waiting')
    .order('queue_number_int', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    return reply(res, 500, {
      success: false,
      error: fetchError.message,
    });
  }

  if (!nextPatient) {
    return reply(res, 404, {
      success: false,
      error: 'no waiting patients',
    });
  }

  const { data, error } = await sb
    .from('queues')
    .update({
      status: 'calling',
      called_at: new Date().toISOString(),
    })
    .eq('id', nextPatient.id)
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
    patient: data,
  });
}
