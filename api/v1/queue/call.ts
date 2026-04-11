import {
  appendActivity,
  createSupabaseServerClient,
  encodeQueueStatus,
  error,
  getPatientRouteState,
  getQueueSchema,
  handleCORSPreflight,
  normaliseQueueStatus,
  parseRequestBody,
  readQueueClinic,
  readQueueOrder,
  requireAuth,
  savePatientRouteState,
  sortQueueRows,
  toAppClinicId,
  toDatabaseClinicId,
  success
} from '../../_lib/json'

export const config = { runtime: 'edge' }

async function assertClinicScope(authPayload: any, clinicId: string) {
  if (authPayload.role === 'doctor' && authPayload.clinicId !== clinicId) {
    throw new Error('Doctor cannot manage another clinic')
  }
}

async function bumpQueueNumbers(supabase: any, queueSchema: any, clinicId: string, fromNumber: number) {
  const queueTable = queueSchema.table
  const { data: rows } = await supabase
    .from(queueTable)
    .select('*')
      .eq(queueSchema.clinicField, clinicId)
      .gte(queueSchema.orderField, fromNumber)
      .order(queueSchema.orderField, { ascending: false })

  for (const row of rows || []) {
    await supabase.from(queueTable).update({ [queueSchema.orderField]: readQueueOrder(row, queueSchema) + 1 }).eq('id', row.id)
  }
}

function buildQueueInsertPayload(row: Record<string, any>, queueSchema: any, overrides: Record<string, any> = {}) {
  return {
    patient_id: row.patient_id,
    patient_name: row.patient_name,
    [queueSchema.clinicField]: readQueueClinic(row, queueSchema),
    [queueSchema.orderField]: readQueueOrder(row, queueSchema),
    [queueSchema.examField]: row[queueSchema.examField] || null,
    qr_code: row.qr_code || null,
    entered_at: row.entered_at || new Date().toISOString(),
    called_at: row.called_at || null,
    completed_at: row.completed_at || null,
    notes: row.notes || null,
    metadata: row.metadata || null,
    status: row.status,
    is_temporary: row.is_temporary || false,
    cancelled_at: row.cancelled_at || null,
    postpone_count: row.postpone_count || 0,
    ...overrides
  }
}

/**
 * Executes doctor/admin queue actions using a single production endpoint.
 */
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return handleCORSPreflight()
  }

  if (req.method !== 'POST') {
    return error('Method not allowed', 405)
  }

  try {
    const authResult = await requireAuth(req, ['admin', 'doctor'])
    if (authResult instanceof Response) {
      return authResult
    }

    const supabase = createSupabaseServerClient()
    const queueSchema = await getQueueSchema(supabase)
    const queueTable = queueSchema.table
    const body = await parseRequestBody<any>(req)
    const action = body?.action || 'call_next'
    const clinicId = body.clinicId || body.clinic
    const clinicDbId = toDatabaseClinicId(clinicId, body.gender || 'male')
    const patientId = body.patientId || ''

    if (!clinicId) {
      return error('clinicId is required', 400)
    }

    await assertClinicScope(authResult, clinicId)

    const { data: clinicRows } = await supabase
      .from(queueTable)
      .select('*')
      .eq(queueSchema.clinicField, clinicDbId)
      .order(queueSchema.orderField, { ascending: true })

    const activeRow = (clinicRows || []).find((row: any) => ['called', 'serving'].includes(normaliseQueueStatus(row.status)))

    if (action === 'call_next') {
      if (activeRow) {
        return success({ patientId: activeRow.patient_id, queueNumber: readQueueOrder(activeRow, queueSchema), clinicId })
      }

      const waitingRows = sortQueueRows((clinicRows || []).filter((row: any) => normaliseQueueStatus(row.status) === 'waiting'), queueSchema)
      const nextWaitingRow = waitingRows[0]
      if (!nextWaitingRow) {
        return success({ patientId: null, queueNumber: null, clinicId })
      }

      const { error: deleteError } = await supabase.from(queueTable).delete().eq('id', nextWaitingRow.id)

      if (deleteError) {
        return error(deleteError.message, 500)
      }

      const { error: insertError } = await supabase.from(queueTable).insert(buildQueueInsertPayload(nextWaitingRow, queueSchema, {
        status: encodeQueueStatus('called', queueTable),
        called_at: new Date().toISOString()
      }))

      if (insertError) {
        return error(insertError.message, 500)
      }

      await appendActivity(supabase, {
        patientId: nextWaitingRow.patient_id,
        clinicId,
        action: 'patient_called',
        details: { queueNumber: readQueueOrder(nextWaitingRow, queueSchema) }
      })

      return success({ patientId: nextWaitingRow.patient_id, queueNumber: readQueueOrder(nextWaitingRow, queueSchema), clinicId })
    }

    const targetRow = (clinicRows || []).find((row: any) => row.patient_id === patientId)
    if (!targetRow) {
      return error('Patient is not present in this clinic queue', 404)
    }

    if (action === 'mark_absent') {
      const { error: deleteError } = await supabase.from(queueTable).delete().eq('id', targetRow.id)

      if (deleteError) {
        return error(deleteError.message, 500)
      }

      const { error: absentError } = await supabase.from(queueTable).insert(buildQueueInsertPayload(targetRow, queueSchema, {
        status: encodeQueueStatus('skipped', queueTable),
        completed_at: new Date().toISOString()
      }))

      if (absentError) {
        return error(absentError.message, 500)
      }

      await supabase.from('patients').update({ status: 'skipped' }).eq('patient_id', patientId)
      const routeState = await getPatientRouteState(supabase, patientId)
      if (routeState) {
        await savePatientRouteState(supabase, { ...routeState, status: 'skipped', currentClinic: clinicId })
      }
      await appendActivity(supabase, { patientId, clinicId, action: 'patient_skipped', details: { queueNumber: readQueueOrder(targetRow, queueSchema) } })
      return success({ patientId, clinicId })
    }

    if (action === 'postpone_patient') {
      const { error: deleteError } = await supabase.from(queueTable).delete().eq('id', targetRow.id)
      if (deleteError) {
        return error(deleteError.message, 500)
      }

      const { error: insertError } = await supabase.from(queueTable).insert(buildQueueInsertPayload(targetRow, queueSchema, {
        status: encodeQueueStatus('waiting', queueTable),
        called_at: null,
        completed_at: null,
        metadata: { ...(targetRow.metadata || {}), postponed: true, vip: false },
        postpone_count: (targetRow.postpone_count || 0) + 1
      }))

      if (insertError) {
        return error(insertError.message, 500)
      }

      const lastNumber = readQueueOrder(targetRow, queueSchema)

      await appendActivity(supabase, { patientId, clinicId, action: 'patient_postponed', details: { queueNumber: lastNumber } })
      return success({ patientId, clinicId, queueNumber: lastNumber })
    }

    if (action === 'transfer_patient') {
      const targetClinicId = body.targetClinicId || ''
      const targetClinicDbId = toDatabaseClinicId(targetClinicId, 'male')
      if (!targetClinicId || targetClinicId === clinicId) {
        return error('targetClinicId must be different from the current clinic', 400)
      }

      const routeState = await getPatientRouteState(supabase, patientId)
      const { data: targetRows } = await supabase.from(queueTable).select(queueSchema.orderField).eq(queueSchema.clinicField, targetClinicDbId).order(queueSchema.orderField, { ascending: false }).limit(1)
      const nextNumber = (readQueueOrder((targetRows || [])[0] || {}, queueSchema) || 0) + 1

      const { error: deleteError } = await supabase.from(queueTable).delete().eq('id', targetRow.id)
      if (deleteError) {
        return error(deleteError.message, 500)
      }

      const { error: transferCompleteInsertError } = await supabase.from(queueTable).insert(buildQueueInsertPayload(targetRow, queueSchema, {
        status: encodeQueueStatus('completed', queueTable),
        completed_at: new Date().toISOString()
      }))
      if (transferCompleteInsertError) {
        return error(transferCompleteInsertError.message, 500)
      }

      const { error: transferInsertError } = await supabase.from(queueTable).insert({
        [queueSchema.clinicField]: targetClinicDbId,
        patient_id: patientId,
        patient_name: patientId,
        [queueSchema.orderField]: nextNumber,
        [queueSchema.examField]: routeState?.examType || null,
        status: encodeQueueStatus('waiting', queueTable),
        entered_at: new Date().toISOString()
      })

      if (transferInsertError) {
        return error(transferInsertError.message, 500)
      }

      const route = Array.isArray(routeState?.route) ? [...routeState.route] : []
      if (typeof routeState?.currentIndex === 'number' && route[routeState.currentIndex]) {
        route[routeState.currentIndex] = targetClinicId
      }

      if (routeState) {
        await savePatientRouteState(supabase, {
          ...routeState,
          route,
          currentClinic: targetClinicId,
          status: 'waiting'
        })
      }

      await appendActivity(supabase, { patientId, clinicId, action: 'patient_transferred', details: { fromClinic: clinicId, targetClinicId, queueNumber: nextNumber } })
      return success({ patientId, clinicId: targetClinicId, queueNumber: nextNumber })
    }

    if (action === 'vip_fast_track') {
      const priorityNumber = activeRow ? readQueueOrder(activeRow, queueSchema) + 1 : 1
      const { error: deleteError } = await supabase.from(queueTable).delete().eq('id', targetRow.id)
      if (deleteError) {
        return error(deleteError.message, 500)
      }

      const { error: insertError } = await supabase.from(queueTable).insert(buildQueueInsertPayload(targetRow, queueSchema, {
        status: encodeQueueStatus('waiting', queueTable),
        called_at: null,
        completed_at: null,
        metadata: { ...(targetRow.metadata || {}), vip: true, postponed: false }
      }))

      if (insertError) {
        return error(insertError.message, 500)
      }

      await appendActivity(supabase, { patientId, clinicId, action: 'patient_vip', details: { queueNumber: priorityNumber } })
      return success({ patientId, clinicId, queueNumber: priorityNumber })
    }

    return error('Unsupported queue action', 400)
  } catch (requestError: any) {
    return error(requestError.message, 500)
  }
}
