import {
  appendActivity,
  createSupabaseServerClient,
  encodeQueueStatus,
  error,
  getPatientRouteState,
  getQueueSchema,
  handleCORSPreflight,
  parseRequestBody,
  readQueueOrder,
  requireAuth,
  savePatientRouteState,
  toDatabaseClinicId,
  success
} from '../../_lib/json'

export const config = { runtime: 'edge' }

/**
 * Completes the current clinic step and opens the next clinic automatically.
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
    const clinicId = body.clinicId || body.clinic
    const clinicDbId = toDatabaseClinicId(clinicId, body.gender || 'male')
    const patientId = body.patientId || body.user

    if (!clinicId || !patientId) {
      return error('clinicId and patientId are required', 400)
    }

    if (authResult.role === 'doctor' && authResult.clinicId !== clinicId) {
      return error('Doctor cannot complete another clinic queue', 403)
    }

    const { data: currentRow } = await supabase
      .from(queueTable)
      .select('*')
      .eq(queueSchema.clinicField, clinicDbId)
      .eq('patient_id', patientId)
      .order(queueSchema.orderField, { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!currentRow) {
      return error('Patient is not present in this clinic queue', 404)
    }

    const routeState = await getPatientRouteState(supabase, patientId)
    const route = Array.isArray(routeState?.route) ? [...routeState.route] : []
    const currentIndex = typeof routeState?.currentIndex === 'number' ? routeState.currentIndex : route.indexOf(clinicId)
    const nextClinic = route[currentIndex + 1] || null

    const replacementRow = {
      patient_id: currentRow.patient_id,
      patient_name: currentRow.patient_name,
      [queueSchema.clinicField]: currentRow[queueSchema.clinicField],
      [queueSchema.orderField]: currentRow[queueSchema.orderField],
      [queueSchema.examField]: currentRow[queueSchema.examField] || null,
      qr_code: currentRow.qr_code || null,
      entered_at: currentRow.entered_at || new Date().toISOString(),
      called_at: currentRow.called_at || null,
      completed_at: new Date().toISOString(),
      notes: currentRow.notes || null,
      metadata: currentRow.metadata || null,
      status: encodeQueueStatus('completed', queueTable),
      is_temporary: currentRow.is_temporary || false,
      cancelled_at: currentRow.cancelled_at || null,
      postpone_count: currentRow.postpone_count || 0
    }

    const { error: deleteError } = await supabase.from(queueTable).delete().eq('id', currentRow.id)
    if (deleteError) {
      return error(deleteError.message, 500)
    }

    const { error: completionInsertError } = await supabase.from(queueTable).insert(replacementRow)
    if (completionInsertError) {
      return error(completionInsertError.message, 500)
    }

    await appendActivity(supabase, {
      patientId,
      clinicId,
      action: 'patient_completed',
      details: { queueNumber: readQueueOrder(currentRow, queueSchema), nextClinic }
    })

    if (nextClinic) {
      const { data: existingNextRow } = await supabase
        .from(queueTable)
        .select('*')
        .eq(queueSchema.clinicField, toDatabaseClinicId(nextClinic, routeState?.gender || 'male'))
        .eq('patient_id', patientId)
        .maybeSingle()

      if (!existingNextRow) {
        const nextClinicDbId = toDatabaseClinicId(nextClinic, routeState?.gender || 'male')
        const { data: targetRows } = await supabase.from(queueTable).select(queueSchema.orderField).eq(queueSchema.clinicField, nextClinicDbId).order(queueSchema.orderField, { ascending: false }).limit(1)
        const nextNumber = (readQueueOrder((targetRows || [])[0] || {}, queueSchema) || 0) + 1

        const { error: nextInsertError } = await supabase.from(queueTable).insert({
          [queueSchema.clinicField]: nextClinicDbId,
          patient_id: patientId,
          patient_name: patientId,
          [queueSchema.orderField]: nextNumber,
          [queueSchema.examField]: routeState?.examType || null,
          status: encodeQueueStatus('waiting', queueTable),
          entered_at: new Date().toISOString()
        })

        if (nextInsertError) {
          return error(nextInsertError.message, 500)
        }

        await appendActivity(supabase, {
          patientId,
          clinicId: nextClinic,
          action: 'patient_waiting',
          details: { queueNumber: nextNumber }
        })
      }

      if (routeState) {
        await savePatientRouteState(supabase, {
          ...routeState,
          currentIndex: currentIndex + 1,
          currentClinic: nextClinic,
          status: 'waiting'
        })
      }

      await supabase.from('patients').update({ status: 'active' }).eq('patient_id', patientId)
    } else {
      if (routeState) {
        await savePatientRouteState(supabase, {
          ...routeState,
          currentIndex,
          currentClinic: null,
          status: 'completed'
        })
      }

      await supabase.from('patients').update({ status: 'completed' }).eq('patient_id', patientId)
    }

    return success({ patientId, clinicId, nextClinic })
  } catch (requestError: any) {
    return error(requestError.message, 500)
  }
}
