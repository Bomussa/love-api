import { createClient } from '@supabase/supabase-js'

/**
 * Shared clinic catalogue used by the frontend and backend contracts.
 */
export const CLINICS = [
  { id: 'lab', name: 'المختبر' },
  { id: 'xray', name: 'الأشعة' },
  { id: 'vitals', name: 'القياسات الحيوية' },
  { id: 'ecg', name: 'تخطيط القلب' },
  { id: 'audio', name: 'السمعيات' },
  { id: 'eyes', name: 'عيادة العيون' },
  { id: 'internal', name: 'عيادة الباطنية' },
  { id: 'ent', name: 'عيادة أنف وأذن وحنجرة' },
  { id: 'surgery', name: 'عيادة الجراحة العامة' },
  { id: 'dental', name: 'عيادة الأسنان' },
  { id: 'psychiatry', name: 'عيادة النفسية' },
  { id: 'derma', name: 'عيادة الجلدية' },
  { id: 'bones', name: 'عيادة العظام والمفاصل' }
]

export const CLINIC_DB_MAP: Record<string, string> = {
  lab: 'LAB',
  xray: 'XR',
  vitals: 'BIO',
  ecg: 'ECG',
  audio: 'AUD',
  eyes: 'EYE',
  internal: 'INT',
  ent: 'ENT',
  surgery: 'SUR',
  dental: 'DNT',
  psychiatry: 'PSY',
  derma: 'DER',
  bones: 'clinic_002'
}

const CLINIC_DB_TO_APP: Record<string, string> = {
  LAB: 'lab',
  XR: 'xray',
  BIO: 'vitals',
  ECG: 'ecg',
  AUD: 'audio',
  EYE: 'eyes',
  F_EYE: 'eyes',
  INT: 'internal',
  F_INT: 'internal',
  ENT: 'ent',
  SUR: 'surgery',
  DNT: 'dental',
  PSY: 'psychiatry',
  DER: 'derma',
  F_DER: 'derma',
  clinic_002: 'bones'
}

export interface CORSOptions {
  origin?: string
  methods?: string
  headers?: string
  maxAge?: number
}

export interface AuthPayload {
  role: 'admin' | 'doctor'
  username: string
  doctorId?: string
  clinicId?: string
  displayName?: string
  exp: number
}

let cachedQueueTable = ''
let cachedActivityTable = ''
let cachedQueueSchema: null | { table: string; clinicField: string; orderField: string; examField: string } = null

/**
 * Reads runtime variables through a safe indirection layer.
 */
export function readEnv(name: string): string {
  const runtimeProcess = (globalThis as any)?.process
  const runtimeEnv = runtimeProcess?.env || {}
  return (runtimeEnv[name] || '').toString().trim()
}

/**
 * Returns the configured CORS headers.
 */
export function getCORSHeaders(options?: CORSOptions): Record<string, string> {
  const origin = options?.origin || readEnv('FRONTEND_ORIGIN') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': options?.methods || 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': options?.headers || 'Content-Type, Authorization',
    'Access-Control-Max-Age': String(options?.maxAge || 86400)
  }
}

/**
 * Serialises a JSON response and injects CORS headers.
 */
export function json(data: any, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')

  Object.entries(getCORSHeaders()).forEach(([key, value]) => {
    if (!headers.has(key)) {
      headers.set(key, value)
    }
  })

  return new Response(JSON.stringify(data), {
    ...init,
    headers
  })
}

/**
 * Standard success contract.
 */
export function success(data: any, status = 200): Response {
  return json({ success: true, data }, { status })
}

/**
 * Standard error contract.
 */
export function error(message: string, status = 500, details?: Record<string, any>): Response {
  return json({ success: false, error: message, ...(details || {}) }, { status })
}

/**
 * Handles OPTIONS preflight requests.
 */
export function handleCORSPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders()
  })
}

/**
 * Parses JSON bodies safely.
 */
export async function parseRequestBody<T = Record<string, any>>(req: Request): Promise<T> {
  try {
    return await req.json()
  } catch {
    return {} as T
  }
}

/**
 * Creates a Supabase client using runtime-only credentials.
 */
export function createSupabaseServerClient() {
  const supabaseUrl = readEnv('SUPABASE_URL') || readEnv('VITE_SUPABASE_URL') || readEnv('NEXT_PUBLIC_SUPABASE_URL')
  const supabaseKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_ANON_KEY') || readEnv('VITE_SUPABASE_ANON_KEY') || readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase configuration missing')
  }

  return createClient(supabaseUrl, supabaseKey)
}

/**
 * Returns the table currently backing the queue engine.
 */
export async function getQueueTable(supabase: any): Promise<string> {
  const queueSchema = await getQueueSchema(supabase)
  return queueSchema.table
}

/**
 * Detects the live queue schema because the production database differs from
 * the local SQL draft.
 */
export async function getQueueSchema(supabase: any): Promise<{ table: string; clinicField: string; orderField: string; examField: string }> {
  if (cachedQueueSchema) {
    return cachedQueueSchema
  }

  const candidates = [
    { table: 'queue', clinicField: 'clinic_id', orderField: 'position', examField: 'exam_type' },
    { table: 'queue', clinicField: 'clinic', orderField: 'number', examField: 'exam_type' },
    { table: 'unified_queue', clinicField: 'clinic_id', orderField: 'queue_number', examField: 'exam_type' }
  ]

  for (const candidate of candidates) {
    const { error: relationError } = await supabase.from(candidate.table).select(`${candidate.clinicField}, ${candidate.orderField}, status`, { head: true, count: 'exact' })
    if (!relationError) {
      cachedQueueSchema = candidate
      cachedQueueTable = candidate.table
      return candidate
    }
  }

  throw new Error('Queue table is not available')
}

/**
 * Returns the clinic value from a queue row regardless of schema version.
 */
export function readQueueClinic(row: Record<string, any>, queueSchema: { clinicField: string }) {
  return row?.[queueSchema.clinicField]
}

/**
 * Returns the queue ordering value from a row regardless of schema version.
 */
export function readQueueOrder(row: Record<string, any>, queueSchema: { orderField: string }) {
  return row?.[queueSchema.orderField]
}

/**
 * Sorts active queue rows using VIP and postpone metadata before the physical position.
 */
export function sortQueueRows(rows: any[], queueSchema: { orderField: string }) {
  return [...rows].sort((left, right) => {
    const leftMeta = left?.metadata || {}
    const rightMeta = right?.metadata || {}
    const leftVip = leftMeta.vip ? 1 : 0
    const rightVip = rightMeta.vip ? 1 : 0
    const leftPostponed = leftMeta.postponed ? 1 : 0
    const rightPostponed = rightMeta.postponed ? 1 : 0

    if (leftVip !== rightVip) return rightVip - leftVip
    if (leftPostponed !== rightPostponed) return leftPostponed - rightPostponed

    return (readQueueOrder(left, queueSchema) || 0) - (readQueueOrder(right, queueSchema) || 0)
  })
}

/**
 * Detects the activity log table.
 */
export async function getActivityTable(supabase: any): Promise<string> {
  if (cachedActivityTable) {
    return cachedActivityTable
  }

  const candidates = ['activity_logs', 'activities']
  for (const table of candidates) {
    const { error: relationError } = await supabase.from(table).select('*', { head: true, count: 'exact' })
    if (!relationError) {
      cachedActivityTable = table
      return table
    }
  }

  throw new Error('Activity log table is not available')
}

/**
 * Normalises every legacy queue status to the final lowercase contract.
 */
export function normaliseQueueStatus(status: string | null | undefined): 'waiting' | 'called' | 'serving' | 'completed' | 'skipped' {
  const value = (status || '').toString().trim().toLowerCase()

  if (['waiting', 'wait', 'queued'].includes(value)) return 'waiting'
  if (['called', 'in_service', 'in-service'].includes(value)) return 'called'
  if (['serving', 'started', 'in'].includes(value)) return 'serving'
  if (['done', 'completed', 'complete'].includes(value)) return 'completed'
  if (['skipped', 'absent', 'no_show'].includes(value)) return 'skipped'

  return 'waiting'
}

/**
 * Converts the final queue status back to the legacy database representation.
 */
export function encodeQueueStatus(status: 'waiting' | 'called' | 'serving' | 'completed' | 'skipped', queueTable: string): string {
  if (queueTable === 'unified_queue' || queueTable === 'queue') {
    if (status === 'serving') return 'called'
    if (status === 'skipped') return 'no_show'
    return status
  }

  return status
}

/**
 * Extracts a bearer token from the request headers.
 */
export function getBearerToken(req: Request): string | null {
  const authorization = req.headers.get('authorization') || ''
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return null
  }

  return authorization.slice(7).trim() || null
}

/**
 * Produces a stable SHA-256 hash string.
 */
export async function sha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, '0')).join('')
}

function toBase64Url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input: string): string {
  const normalised = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalised.length % 4 === 0 ? '' : '='.repeat(4 - (normalised.length % 4))
  return atob(`${normalised}${padding}`)
}

/**
 * Signs an auth payload with the admin secret.
 */
export async function signAuthToken(payload: Omit<AuthPayload, 'exp'> & { exp?: number }): Promise<string> {
  const secret = readEnv('ADMIN_AUTH_SECRET')
  if (!secret) {
    throw new Error('ADMIN_AUTH_SECRET is missing')
  }

  const completePayload: AuthPayload = {
    ...payload,
    exp: payload.exp || Math.floor(Date.now() / 1000) + (60 * 60 * 8)
  }

  const body = toBase64Url(JSON.stringify(completePayload))
  const signature = await sha256(`${body}.${secret}`)
  return `${body}.${signature}`
}

/**
 * Verifies and decodes an auth token.
 */
export async function verifyAuthToken(token: string | null): Promise<AuthPayload | null> {
  if (!token) {
    return null
  }

  const secret = readEnv('ADMIN_AUTH_SECRET')
  if (!secret) {
    return null
  }

  const [body, signature] = token.split('.')
  if (!body || !signature) {
    return null
  }

  const expectedSignature = await sha256(`${body}.${secret}`)
  if (expectedSignature !== signature) {
    return null
  }

  const payload = JSON.parse(fromBase64Url(body)) as AuthPayload
  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return null
  }

  return payload
}

/**
 * Validates the incoming auth token against the required roles.
 */
export async function requireAuth(req: Request, allowedRoles: Array<'admin' | 'doctor'>): Promise<AuthPayload | Response> {
  const payload = await verifyAuthToken(getBearerToken(req))
  if (!payload || !allowedRoles.includes(payload.role)) {
    return error('Unauthorized', 401)
  }

  return payload
}

/**
 * Returns the Arabic clinic label.
 */
export function getClinicName(clinicId: string): string {
  const appClinicId = toAppClinicId(clinicId)
  return CLINICS.find((clinic) => clinic.id === appClinicId)?.name || clinicId
}

/**
 * Maps an application clinic id to the live database clinic id.
 */
export function toDatabaseClinicId(clinicId: string, gender = 'male'): string {
  if (gender === 'female' && clinicId === 'eyes') return 'F_EYE'
  if (gender === 'female' && clinicId === 'internal') return 'F_INT'
  if (gender === 'female' && clinicId === 'derma') return 'F_DER'
  return CLINIC_DB_MAP[clinicId] || clinicId
}

/**
 * Maps a database clinic id back to the frontend clinic id.
 */
export function toAppClinicId(clinicId: string): string {
  return CLINIC_DB_TO_APP[clinicId] || clinicId
}

/**
 * Persists the live route snapshot for one patient.
 */
export async function savePatientRouteState(
  supabase: any,
  payload: { patientId: string; route: string[]; currentIndex: number; currentClinic: string | null; examType: string; status: string; gender?: string }
) {
  const { data: patient } = await supabase.from('patients').select('id').eq('patient_id', payload.patientId).single()
  const stations = payload.route.map((clinicId) => {
    const dbClinicId = toDatabaseClinicId(clinicId, payload.gender || 'male')
    return {
      id: dbClinicId,
      code: dbClinicId,
      appId: clinicId,
      name: getClinicName(clinicId),
      nameAr: getClinicName(clinicId)
    }
  })

  const { data: existingRoute } = await supabase
    .from('patient_routes')
    .select('id')
    .eq('patient_id', patient.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const routePayload = {
    patient_id: patient.id,
    exam_type: payload.examType,
    gender: payload.gender || 'male',
    stations,
    current_station_index: payload.currentIndex,
    status: payload.status,
    updated_at: new Date().toISOString()
  }

  if (existingRoute?.id) {
    await supabase.from('patient_routes').update(routePayload).eq('id', existingRoute.id)
    return
  }

  await supabase.from('patient_routes').insert(routePayload)
}

/**
 * Reads the latest route snapshot for a patient from the activity log.
 */
export async function getPatientRouteState(supabase: any, patientId: string) {
  const { data: patient } = await supabase.from('patients').select('id').eq('patient_id', patientId).maybeSingle()
  if (!patient?.id) {
    return null
  }

  const { data: routeRecord } = await supabase
    .from('patient_routes')
    .select('*')
    .eq('patient_id', patient.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!routeRecord) {
    return null
  }

  const route = Array.isArray(routeRecord.stations)
    ? routeRecord.stations.map((station: any) => toAppClinicId(station.appId || station.id || station.code))
    : []

  return {
    patientId,
    route,
    currentIndex: routeRecord.current_station_index || 0,
    currentClinic: route[routeRecord.current_station_index || 0] || null,
    examType: routeRecord.exam_type,
    status: routeRecord.status,
    gender: routeRecord.gender,
    routeRecordId: routeRecord.id
  }
}

/**
 * Appends an audit entry to the shared activities table.
 */
export async function appendActivity(
  supabase: any,
  payload: { patientId: string; clinicId: string; action: string; details?: Record<string, any> }
) {
  const activityTable = await getActivityTable(supabase)

  if (activityTable === 'activities') {
    await supabase.from(activityTable).insert({
      patient_id: payload.patientId,
      clinic: payload.clinicId,
      action: payload.action,
      details: payload.details || {},
      timestamp: new Date().toISOString()
    })
    return
  }

  await supabase.from(activityTable).insert({
    action_type: payload.action,
    description: payload.action,
    user_id: null,
    metadata: {
      patientId: payload.patientId,
      clinicId: payload.clinicId,
      ...(payload.details || {})
    },
    created_at: new Date().toISOString()
  })
}

/**
 * Reconstructs the latest doctor records from the audit log.
 */
export async function getDoctorRecords(supabase: any) {
  const activityTable = await getActivityTable(supabase)
  const records = new Map<string, any>()

  if (activityTable === 'activities') {
    const { data, error: doctorError } = await supabase
      .from(activityTable)
      .select('id, clinic, patient_id, action, details, timestamp')
      .eq('action', 'doctor_account')
      .order('timestamp', { ascending: false })

    if (doctorError) {
      throw new Error(doctorError.message)
    }

    for (const entry of data || []) {
      const details = entry.details || {}
      const doctorId = details.doctorId || entry.patient_id
      if (!doctorId || records.has(doctorId) || details.isDeleted) {
        continue
      }

      records.set(doctorId, {
        id: doctorId,
        doctorId,
        username: details.username,
        displayName: details.displayName,
        clinicId: details.clinicId || entry.clinic,
        clinicName: getClinicName(details.clinicId || entry.clinic),
        passwordHash: details.passwordHash,
        isFrozen: Boolean(details.isFrozen),
        createdAt: entry.timestamp
      })
    }

    return Array.from(records.values())
  }

  const { data, error: doctorError } = await supabase
    .from(activityTable)
    .select('*')
    .eq('action_type', 'doctor_account')
    .order('created_at', { ascending: false })

  if (doctorError) {
    throw new Error(doctorError.message)
  }

  for (const entry of data || []) {
    const details = entry.metadata || {}
    const doctorId = details.doctorId
    if (!doctorId || records.has(doctorId) || details.isDeleted) {
      continue
    }

    records.set(doctorId, {
      id: doctorId,
      doctorId,
      username: details.username,
      displayName: details.displayName,
      clinicId: details.clinicId,
      clinicName: getClinicName(details.clinicId),
      passwordHash: details.passwordHash,
      isFrozen: Boolean(details.isFrozen),
      createdAt: entry.created_at
    })
  }

  return Array.from(records.values())
}
