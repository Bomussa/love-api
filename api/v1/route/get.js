import { sb, reply, normalizeQuery } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return reply(res, 405, { success: false, error: 'Method not allowed' });
  }

  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const query = normalizeQuery(Object.fromEntries(parsed.searchParams));

  const patientId = query.patient_id;
  const routeId = query.route_id;

  if (!patientId && !routeId) {
    return reply(res, 400, {
      success: false,
      error: 'patient_id or route_id required',
    });
  }

  let request = sb.from('patient_routes').select('*');

  if (routeId) {
    request = request.eq('id', routeId);
  } else {
    request = request
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(1);
  }

  const { data, error } = await request.maybeSingle();

  if (error) {
    return reply(res, 404, {
      success: false,
      error: error.message,
    });
  }

  if (!data) {
    return reply(res, 404, {
      success: false,
      error: 'route not found',
    });
  }

  return reply(res, 200, {
    success: true,
    route: data,
  });
}
