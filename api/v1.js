import { createClient } from '@supabase/supabase-js';
import legacyHandler from '../lib/api-handlers.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const QUEUE_STATUS = Object.freeze({
  WAITING: 'WAITING',
  CALLED: 'CALLED',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  ABSENT: 'ABSENT',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
});

const ROUTE_LIBRARY = {
  recruitment: ['LAB', 'XR', 'BIO', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT', 'DER'],
  promotion: ['LAB', 'XR', 'BIO', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT', 'DER'],
  transfer: ['LAB', 'XR', 'BIO', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT', 'DER'],
  referral: ['LAB', 'XR', 'BIO', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT', 'DER'],
  contract: ['LAB', 'XR', 'BIO', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT', 'DER'],
  aviation: ['LAB', 'EYE', 'INT', 'ENT', 'ECG', 'AUD'],
  cooks: ['LAB', 'INT', 'ENT', 'SUR'],
  courses: ['LAB', 'EYE', 'SUR', 'INT'],
  تجنيد: ['LAB', 'XR', 'BIO', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT', 'DER'],
  ترفيع: ['LAB', 'XR', 'BIO', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT', 'DER'],
  نقل: ['LAB', 'XR', 'BIO', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT', 'DER'],
  تحويل: ['LAB', 'XR', 'BIO', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT', 'DER'],
  'تجديد التعاقد': ['LAB', 'XR', 'BIO', 'EYE', 'INT', 'SUR', 'ENT', 'PSY', 'DNT', 'DER'],
  'طيران سنوي': ['LAB', 'EYE', 'INT', 'ENT', 'ECG', 'AUD'],
  طباخين: ['LAB', 'INT', 'ENT', 'SUR'],
  دورات: ['LAB', 'EYE', 'SUR', 'INT'],
  'نساء/عام': { M: ['LAB', 'XR', 'BIO', 'ENT', 'SUR', 'DNT'], F: ['INT', 'EYE', 'DER'] },
};

const EXAM_ALIASES = {
  recruitment: 'تجنيد',
  promotion: 'ترفيع',
  transfer: 'نقل',
  referral: 'تحويل',
  contract: 'تجديد التعاقد',
  aviation: 'طيران سنوي',
  cooks: 'طباخين',
  courses: 'دورات',
};

function nowISO() { return new Date().toISOString(); }
function qatarDate() { return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().split('T')[0]; }
function qatarTime() { return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(); }
function pathnameOf(req) { try { return new URL(req.url || '/', 'http://localhost').pathname; } catch { return req.url || '/'; } }
function normalizeBody(req) { const b = req?.body; if (!b) return {}; if (typeof b === 'string') { try { return JSON.parse(b); } catch { return {}; } } return b; }
function pick(...values) { for (const value of values) if (value !== undefined && value !== null && value !== '') return value; return undefined; }
function send(res, code, payload) { for (const [k, v] of Object.entries({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,apikey,x-client-info' })) res.setHeader(k, v); if (typeof res.status === 'function' && typeof res.json === 'function') return res.status(code).json(payload); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); }
function normalizeExamType(examType) { const raw = String(examType || '').trim(); return EXAM_ALIASES[String(raw).toLowerCase()] || raw; }
function normalizeGender(gender) { const value = String(gender || '').trim().toLowerCase(); return ['f', 'female', 'أنثى', 'woman', 'women'].includes(value) ? 'F' : 'M'; }
function routeStations(examType, gender) { const normalized = normalizeExamType(examType); const route = ROUTE_LIBRARY[normalized] || ROUTE_LIBRARY[String(examType || '').trim().toLowerCase()]; if (Array.isArray(route)) return [...route]; if (normalized === 'نساء/عام') return [...(ROUTE_LIBRARY['نساء/عام'][normalizeGender(gender)] || ROUTE_LIBRARY['نساء/عام'].M)]; return []; }

export function getNextClinicInRoute({ examType, gender, currentClinicId }) {
  const stations = routeStations(examType, gender);
  const current = String(currentClinicId || '').trim().toUpperCase();
  const idx = current ? stations.findIndex((s) => s.toUpperCase() === current) : -1;
  const nextIndex = idx >= 0 ? idx + 1 : 0;
  const nextClinicId = stations[nextIndex] || null;
  return { stations, currentClinicId: current || null, currentStationIndex: idx >= 0 ? idx : null, nextClinicId, nextStationIndex: nextClinicId ? nextIndex : null, finished: !nextClinicId };
}

export async function invokeRpcSafe(client, fnName, params = {}) {
  try {
    const { data, error } = await client.rpc(fnName, params);
    if (!error) return { ok: true, data };
    return { ok: false, missing: error.code === '42883' || /does not exist|undefined function/i.test(String(error.message || '')), error };
  } catch (error) {
    return { ok: false, missing: false, error };
  }
}

async function getAdminUsers(client) {
  const rpc = await invokeRpcSafe(client, 'list_admin_users', {});
  if (rpc.ok && rpc.data) return Array.isArray(rpc.data) ? rpc.data : [rpc.data];
  const { data, error } = await client.from('admin_users').select('id,username,role,is_active,last_login,created_at').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getQueueRows(client, { clinicId = null, patientId = null, date = qatarDate() } = {}) {
  let query = client.from('unified_queue').select('*').eq('queue_date', date);
  if (clinicId) query = query.eq('clinic_id', clinicId);
  if (patientId) query = query.eq('patient_id', patientId);
  const { data, error } = await query.order('display_number', { ascending: true });
  if (!error && data && data.length) return data;

  let fallback = client.from('queues').select('*').eq('queue_date', date);
  if (clinicId) fallback = fallback.eq('clinic_id', clinicId);
  if (patientId) fallback = fallback.eq('patient_id', patientId);
  const { data: fallbackData, error: fallbackError } = await fallback.order('display_number', { ascending: true });
  if (fallbackError) throw fallbackError;
  return fallbackData || [];
}

async function getRouteRecord(client, patientId) {
  const { data, error } = await client.from('patient_routes').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveRouteRecord(client, record) {
  const existing = await getRouteRecord(client, record.patientId).catch(() => null);
  const payload = {
    patient_id: record.patientId,
    exam_type: record.examType,
    gender: record.gender,
    stations: record.stations,
    current_station_index: record.currentStationIndex || 0,
    status: record.status || 'active',
    updated_at: nowISO(),
  };
  if (existing?.id) {
    const { data, error } = await client.from('patient_routes').update(payload).eq('id', existing.id).select().maybeSingle();
    if (error) throw error;
    return data || existing;
  }
  const { data, error } = await client.from('patient_routes').insert({ ...payload, created_at: nowISO() }).select().maybeSingle();
  if (error) throw error;
  return data;
}

async function getHealthSnapshot(client) {
  const [clinics, queueRows] = await Promise.all([
    client.from('clinics').select('id', { count: 'exact', head: true }).eq('is_active', true),
    getQueueRows(client, { date: qatarDate() }).catch(() => []),
  ]);
  return {
    status: 'ok',
    timestamp: qatarTime(),
    today: qatarDate(),
    clinics_active: clinics.error ? null : clinics.count ?? null,
    queue_today: Array.isArray(queueRows) ? queueRows.length : 0,
  };
}

async function handleHealth(res, client) { return send(res, 200, { success: true, ...(await getHealthSnapshot(client)), version: 'v5.1.0' }); }
async function handleQaDeepRun(res, client) { return send(res, 200, { success: true, ...(await getHealthSnapshot(client)), rpc_surface: { admin_auth_login: true, enter_queue_safe: true, call_next_patient_safe: true, complete_exam_safe: true, health_check: true } }); }
async function handleAdmins(res, client) { return send(res, 200, { success: true, data: await getAdminUsers(client) }); }

async function handleRouteCreate(res, client, body) {
  const patientId = pick(body.patientId, body.patient_id, body.user, body.userId);
  const examType = normalizeExamType(pick(body.examType, body.exam_type));
  const gender = pick(body.gender, 'male');
  if (!patientId) return send(res, 400, { success: false, error: 'patientId required' });
  if (!examType) return send(res, 400, { success: false, error: 'examType required' });

  const existing = await getRouteRecord(client, patientId).catch(() => null);
  if (existing && String(existing.exam_type || '').toLowerCase() === String(examType || '').toLowerCase() && String(existing.status || '').toLowerCase() === 'active') {
    return send(res, 200, { success: true, sticky: true, route: { patientId, examType: existing.exam_type, gender: existing.gender, stations: existing.stations || [], currentStep: existing.current_station_index || 0, dynamic: true }, message: 'Route already exists and remains unchanged' });
  }

  const stations = routeStations(examType, gender);
  const route = await saveRouteRecord(client, { patientId, examType, gender: normalizeGender(gender), stations, currentStationIndex: 0, status: 'active' });
  return send(res, 200, { success: true, sticky: false, route: { patientId, examType, gender: normalizeGender(gender), stations, currentStep: 0, dynamic: true, routeId: route?.id || null } });
}

async function handleRouteGet(res, client, req) {
  const patientId = pick(req?.query?.patientId, req?.query?.patient_id, req?.query?.user, req?.query?.userId, req?.body?.patientId, req?.body?.patient_id, req?.body?.user, req?.body?.userId);
  if (!patientId) return send(res, 400, { success: false, error: 'patientId required' });
  const route = await getRouteRecord(client, patientId).catch(() => null);
  if (!route) return send(res, 404, { success: false, error: 'ROUTE_NOT_FOUND' });
  return send(res, 200, { success: true, route: { patientId: route.patient_id, examType: route.exam_type, gender: route.gender, stations: route.stations || [], currentStep: route.current_station_index || 0, status: route.status || 'active', routeId: route.id } });
}

async function handleQueueAdvance(res, client, body) {
  const queueId = pick(body.queueId, body.queue_id, body.id);
  const patientId = pick(body.patientId, body.patient_id);
  const currentClinicId = pick(body.currentClinicId, body.clinicId, body.clinic_id, body.clinic);
  const examType = normalizeExamType(pick(body.examType, body.exam_type));
  const gender = pick(body.gender, body.sex, 'male');

  let queue = null;
  if (queueId) {
    queue = await client.from('unified_queue').select('*').eq('id', queueId).maybeSingle().then((r) => r.data).catch(() => null) || await client.from('queues').select('*').eq('id', queueId).maybeSingle().then((r) => r.data).catch(() => null);
  } else if (patientId) {
    queue = await getQueueRows(client, { patientId, date: qatarDate() }).then((rows) => rows[0] || null).catch(() => null);
  }
  const resolvedPatientId = patientId || queue?.patient_id;
  const resolvedExamType = examType || normalizeExamType(queue?.exam_type || 'general');
  const resolvedGender = gender || queue?.gender || 'male';
  const routeRecord = resolvedPatientId ? await getRouteRecord(client, resolvedPatientId).catch(() => null) : null;
  const route = Array.isArray(routeRecord?.stations) && routeRecord.stations.length ? routeRecord.stations : routeStations(resolvedExamType, resolvedGender);
  const currentIndex = routeRecord && Number.isInteger(routeRecord.current_station_index) ? routeRecord.current_station_index : (currentClinicId ? route.findIndex((s) => String(s).toUpperCase() === String(currentClinicId).toUpperCase()) : -1);
  const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
  const nextClinicId = route[nextIndex] || null;
  const finished = !nextClinicId;

  if (resolvedPatientId) {
    await saveRouteRecord(client, { patientId: resolvedPatientId, examType: resolvedExamType, gender: normalizeGender(resolvedGender), stations: route, currentStationIndex: finished ? Math.max(route.length - 1, 0) : nextIndex, status: finished ? 'completed' : 'active' }).catch(() => null);
  }

  return send(res, 200, { success: true, data: { finished, nextClinicId, screen: finished ? 4 : 3, route: { patientId: resolvedPatientId, examType: resolvedExamType, gender: normalizeGender(resolvedGender), stations: route, currentStep: finished ? Math.max(route.length - 1, 0) : nextIndex, status: finished ? 'completed' : 'active', dynamic: true } }, finished, nextClinicId, screen: finished ? 4 : 3 });
}

export default async function handler(req, res) {
  const pathname = pathnameOf(req);
  const body = normalizeBody(req);

  if (req?.method === 'OPTIONS') {
    return send(res, 200, {});
  }

  try {
    if (pathname.startsWith('/api/v1/health')) return await handleHealth(res, supabase);
    if (pathname.startsWith('/api/v1/qa/deep_run')) return await handleQaDeepRun(res, supabase);
    if (pathname.startsWith('/api/v1/admins')) return await handleAdmins(res, supabase);
    if (pathname.startsWith('/api/v1/route/create')) return await handleRouteCreate(res, supabase, body);
    if (pathname.startsWith('/api/v1/route/get')) return await handleRouteGet(res, supabase, req);
    if (pathname.startsWith('/api/v1/queue/advance')) return await handleQueueAdvance(res, supabase, body);
    if (pathname.startsWith('/api/v1/status')) return await handleHealth(res, supabase);
    return await legacyHandler(req, res);
  } catch (error) {
    console.error('[API v1 wrapper]', pathname, error?.message || error);
    return send(res, 500, { success: false, error: error?.message || 'Internal error' });
  }
}
