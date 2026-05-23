import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export function reply(res, status, payload) {
  return res.status(status).json(payload);
}

export function normalizeQuery(query = {}) {
  return {
    ...query,
    patient_id: query.patient_id || query.patientId || query.user || null,
    clinic_id: query.clinic_id || query.clinicId || query.clinic || null,
    route_id: query.route_id || query.routeId || null,
  };
}

export function normalizeBody(body = {}) {
  return {
    ...body,
    patient_id: body.patient_id || body.patientId || body.user || null,
    clinic_id: body.clinic_id || body.clinicId || body.clinic || null,
    route_id: body.route_id || body.routeId || null,
  };
}
