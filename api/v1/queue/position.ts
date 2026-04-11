import {
  createSupabaseServerClient,
  error,
  getQueueSchema,
  handleCORSPreflight,
  normaliseQueueStatus,
  readQueueOrder,
  sortQueueRows,
  toDatabaseClinicId,
  success
} from '../../_lib/json'

export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return handleCORSPreflight()
  }

  if (req.method !== 'GET') {
    return error('Method not allowed', 405)
  }

  try {
    const url = new URL(req.url)
    const clinic = url.searchParams.get('clinic') || ''
    const clinicDbId = toDatabaseClinicId(clinic, 'male')
    const user = url.searchParams.get('user') || ''

    if (!clinic || !user) {
      return error('Missing parameters', 400)
    }

    const supabase = createSupabaseServerClient()
    const queueSchema = await getQueueSchema(supabase)
    const queueTable = queueSchema.table

    const { data: entry, error: entryError } = await supabase
      .from(queueTable)
      .select('*')
      .eq(queueSchema.clinicField, clinicDbId)
      .eq('patient_id', user)
      .order(queueSchema.orderField, { ascending: false })
      .limit(1)
      .maybeSingle()

    if (entryError || !entry) {
      return error('Not in queue', 404)
    }

    const { data: clinicRows, error: clinicError } = await supabase
      .from(queueTable)
      .select('*')
      .eq(queueSchema.clinicField, clinicDbId)
      .order(queueSchema.orderField, { ascending: true })

    if (clinicError) {
      return error(clinicError.message, 500)
    }

    const waitingRows = sortQueueRows((clinicRows || []).filter((row: any) => normaliseQueueStatus(row.status) === 'waiting'), queueSchema)
    const currentServing = (clinicRows || []).find((row: any) => ['called', 'serving'].includes(normaliseQueueStatus(row.status)))
    const queueNumber = readQueueOrder(entry, queueSchema)
    const ahead = waitingRows.filter((row: any) => readQueueOrder(row, queueSchema) < queueNumber).length

    return success({
      clinic,
      patientId: user,
      queueNumber,
      displayNumber: ahead + 1,
      ahead,
      currentServingNumber: currentServing ? readQueueOrder(currentServing, queueSchema) : null,
      status: normaliseQueueStatus(entry.status),
      totalWaiting: waitingRows.length
    })

  } catch (requestError: any) {
    return error(requestError.message, 500)
  }
}
