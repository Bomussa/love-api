import {
  createSupabaseServerClient,
  error,
  getQueueSchema,
  handleCORSPreflight,
  normaliseQueueStatus,
  parseRequestBody,
  readQueueOrder,
  toDatabaseClinicId,
  success
} from '../../_lib/json'

export const config = { runtime: 'edge' }

/**
 * Adds a patient to a clinic queue using the unified API contract.
 */
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return handleCORSPreflight()
  }

  if (req.method !== 'POST') {
    return error('Method not allowed', 405)
  }

  try {
    const body = await parseRequestBody<any>(req)
    const clinicId = body.clinicId || body.clinic
    const clinicDbId = toDatabaseClinicId(clinicId, body.gender || 'male')
    const patientId = body.patientId || body.user

    if (!clinicId || !patientId) {
      return error('Missing clinicId or patientId', 400)
    }

    const supabase = createSupabaseServerClient()
    const queueSchema = await getQueueSchema(supabase)
    const queueTable = queueSchema.table

    const { data: clinicRows } = await supabase
      .from(queueTable)
      .select('*')
      .eq(queueSchema.clinicField, clinicDbId)
      .order(queueSchema.orderField, { ascending: true })

    const existingRow = (clinicRows || []).find((row: any) => row.patient_id === patientId)
    if (existingRow) {
      const waitingRows = (clinicRows || []).filter((row: any) => normaliseQueueStatus(row.status) === 'waiting')
      return success({
        clinicId,
        patientId,
        queueNumber: readQueueOrder(existingRow, queueSchema),
        ahead: waitingRows.filter((row: any) => readQueueOrder(row, queueSchema) < readQueueOrder(existingRow, queueSchema)).length,
        displayNumber: waitingRows.filter((row: any) => readQueueOrder(row, queueSchema) <= readQueueOrder(existingRow, queueSchema)).length || 1,
        status: normaliseQueueStatus(existingRow.status)
      })
    }

    const nextNumber = (clinicRows || []).reduce((max: number, row: any) => Math.max(max, readQueueOrder(row, queueSchema) || 0), 0) + 1
    const { error: insertError } = await supabase.from(queueTable).insert({
      [queueSchema.clinicField]: clinicDbId,
      patient_id: patientId,
      patient_name: patientId,
      [queueSchema.orderField]: nextNumber,
      status: 'waiting',
      entered_at: new Date().toISOString()
    })

    if (insertError) {
      return error(insertError.message, 500)
    }

    return success({
      clinicId,
      patientId,
      queueNumber: nextNumber,
      ahead: (clinicRows || []).filter((row: any) => normaliseQueueStatus(row.status) === 'waiting').length,
      displayNumber: (clinicRows || []).filter((row: any) => normaliseQueueStatus(row.status) === 'waiting').length + 1,
      status: 'waiting'
    })
  } catch (requestError: any) {
    return error(requestError.message, 500)
  }
}
