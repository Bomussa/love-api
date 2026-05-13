const QUEUE_STATUS = Object.freeze({
  WAITING: 'WAITING',
  IN_SERVICE: 'IN_SERVICE',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
});

const CLINIC_ROUTES = Object.freeze({
  recruitment: {
    male: ['LAB', 'XR', 'EYE', 'DNT'],
    female: ['LAB', 'XR', 'EYE', 'DNT'],
  },
});

function resolveRoute(examType, gender) {
  const typeKey = String(examType || '').toLowerCase();
  const genderKey = String(gender || '').toLowerCase();
  const typeRoutes = CLINIC_ROUTES[typeKey] || {};
  return typeRoutes[genderKey] || typeRoutes.male || [];
}

export async function invokeRpcSafe(supabase, functionName, payload = {}) {
  const { data, error } = await supabase.rpc(functionName, payload);

  if (!error) {
    return { ok: true, data };
  }

  const missing = ['42883', 'PGRST202'].includes(error.code)
    || /does not exist/i.test(String(error.message || ''));

  return {
    ok: false,
    missing,
    code: error.code || null,
    error: error.message || 'Unknown RPC error',
  };
}

export function getNextClinicInRoute({ examType, gender, currentClinicId }) {
  const route = resolveRoute(examType, gender);
  const current = String(currentClinicId || '').toUpperCase();

  if (route.length === 0) {
    return { nextClinicId: null, finished: true, route: [] };
  }

  const currentIndex = route.indexOf(current);
  if (currentIndex < 0) {
    return { nextClinicId: route[0], finished: false, route };
  }

  const nextClinicId = route[currentIndex + 1] || null;
  return {
    nextClinicId,
    finished: nextClinicId === null,
    route,
  };
}

export { QUEUE_STATUS };


// Keep explicit route literals for contract checks and compatibility tooling.
export function isKnownV1Route(pathname) {
  return (
    pathname === '/api/v1/health' ||
    pathname === '/api/v1/admin/login' ||
    pathname === '/api/v1/admins' ||
    pathname === '/api/v1/status' ||
    pathname === '/api/v1/patient/login' ||
    pathname === '/api/v1/queue/enter' ||
    pathname === '/api/v1/queue/status' ||
    pathname === '/api/v1/queue/call' ||
    pathname === '/api/v1/queue/advance' ||
    pathname === '/api/v1/pin/verify' ||
    pathname === '/api/v1/qa/deep_run'
  );
}
