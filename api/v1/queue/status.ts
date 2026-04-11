import {
  CLINICS,
  createSupabaseServerClient,
  error,
  getActivityTable,
  getPatientRouteState,
  getClinicName,
  getQueueSchema,
  handleCORSPreflight,
  normaliseQueueStatus,
  readQueueClinic,
  readQueueOrder,
  requireAuth,
  sortQueueRows,
  toAppClinicId,
  toDatabaseClinicId,
  success
} from '../../_lib/json'

export const config = { runtime: 'edge' }

/**
 * Converts queue states into end-user labels.
 */
function statusLabel(status: string) {
  if (status === 'waiting') return 'في الانتظار'
  if (status === 'called' || status === 'serving') return 'قيد الخدمة'
  if (status === 'completed') return 'مكتمل'
  if (status === 'skipped') return 'غياب'
  return 'بانتظار التحديث'
}

/**
 * Returns queue details for patient, doctor, or clinic views.
 */
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return handleCORSPreflight()
  }

  if (req.method !== 'GET') {
    return error('Method not allowed', 405)
  }

  try {
    const supabase = createSupabaseServerClient()
    const queueSchema = await getQueueSchema(supabase)
    const queueTable = queueSchema.table
    const url = new URL(req.url)
    const clinicId = url.searchParams.get('clinic') || ''
    const patientId = url.searchParams.get('patientId') || ''
    const doctorId = url.searchParams.get('doctorId') || ''

    if (patientId) {
      const { data: patient } = await supabase
        .from('patients')
        .select('*')
        .eq('patient_id', patientId)
        .maybeSingle()

      if (!patient) {
        return error('Patient not found', 404)
      }

      const routeState = await getPatientRouteState(supabase, patientId)
      const route = Array.isArray(routeState?.route) ? routeState.route : []
      const { data: patientRows } = await supabase
        .from(queueTable)
        .select('*')
        .eq('patient_id', patientId)
        .order(queueSchema.orderField, { ascending: true })

      const activityTable = await getActivityTable(supabase)
      const patientActivitiesResponse = activityTable === 'activities'
        ? await supabase
            .from(activityTable)
            .select('*')
            .eq('patient_id', patientId)
            .order('timestamp', { ascending: false })
        : await supabase
            .from(activityTable)
            .select('*')
            .order('created_at', { ascending: false })

      const patientActivities = activityTable === 'activities'
        ? (patientActivitiesResponse.data || [])
        : (patientActivitiesResponse.data || []).filter((activity: any) => activity.metadata?.patientId === patientId)

      const skippedClinics = new Set((patientActivities || []).map((activity: any) => toAppClinicId(activity.clinic || activity.metadata?.clinicId)).filter(Boolean))
      const currentClinicId = routeState?.currentClinic || route[routeState?.currentIndex || 0] || null
      const currentRow = (patientRows || []).find((row: any) => (
        toAppClinicId(readQueueClinic(row, queueSchema)) === currentClinicId &&
        ['waiting', 'called', 'serving'].includes(normaliseQueueStatus(row.status))
      )) || (patientRows || []).find((row: any) => normaliseQueueStatus(row.status) === 'called')

      const steps = await Promise.all(route.map(async (routeClinicId: string, index: number) => {
        const { data: clinicRows } = await supabase
          .from(queueTable)
          .select('*')
          .eq(queueSchema.clinicField, toDatabaseClinicId(routeClinicId, routeState?.gender || patient.gender || 'male'))
          .order(queueSchema.orderField, { ascending: true })

        const routeRow = (patientRows || []).filter((row: any) => toAppClinicId(readQueueClinic(row, queueSchema)) === routeClinicId).slice(-1)[0]
        const waitingRows = sortQueueRows((clinicRows || []).filter((row: any) => normaliseQueueStatus(row.status) === 'waiting'), queueSchema)
        const currentServing = (clinicRows || []).find((row: any) => ['called', 'serving'].includes(normaliseQueueStatus(row.status)))

        let status = 'pending'
        if (routeRow) {
          status = normaliseQueueStatus(routeRow.status)
        } else if (skippedClinics.has(routeClinicId) && routeState?.currentClinic === routeClinicId) {
          status = 'skipped'
        } else if ((routeState?.currentIndex || 0) > index) {
          status = 'completed'
        }

        return {
          clinicId: routeClinicId,
          clinicName: getClinicName(routeClinicId),
          queueNumber: routeRow ? readQueueOrder(routeRow, queueSchema) : null,
          ahead: routeRow ? waitingRows.filter((row: any) => readQueueOrder(row, queueSchema) < readQueueOrder(routeRow, queueSchema)).length : null,
          status,
          statusLabel: statusLabel(status),
          currentServingNumber: currentServing ? readQueueOrder(currentServing, queueSchema) : null,
          note: status === 'skipped'
            ? 'تم تسجيل الحالة كغياب'
            : status === 'completed'
              ? 'تم إنجاز هذه المحطة'
              : status === 'waiting'
                ? 'بانتظار النداء'
                : status === 'called'
                  ? 'تم استدعاؤك الآن'
                  : 'بانتظار الوصول لهذه المحطة'
        }
      }))

      const currentClinicRows = currentRow
        ? await supabase.from(queueTable).select('*').eq(queueSchema.clinicField, readQueueClinic(currentRow, queueSchema)).order(queueSchema.orderField, { ascending: true })
        : { data: [] }

      const currentWaitingRows = sortQueueRows((currentClinicRows.data || []).filter((row: any) => normaliseQueueStatus(row.status) === 'waiting'), queueSchema)
      const currentServing = (currentClinicRows.data || []).find((row: any) => ['called', 'serving'].includes(normaliseQueueStatus(row.status)))

      return success({
        patientId,
        examType: patient.exam_type,
        updatedAt: patient.updated_at || patient.last_active || patient.created_at,
        currentVisit: currentRow
          ? {
              clinicId: toAppClinicId(readQueueClinic(currentRow, queueSchema)),
              clinicName: getClinicName(toAppClinicId(readQueueClinic(currentRow, queueSchema))),
              queueNumber: readQueueOrder(currentRow, queueSchema),
              ahead: currentWaitingRows.filter((row: any) => readQueueOrder(row, queueSchema) < readQueueOrder(currentRow, queueSchema)).length,
              currentServingNumber: currentServing ? readQueueOrder(currentServing, queueSchema) : null,
              status: normaliseQueueStatus(currentRow.status),
              statusLabel: statusLabel(normaliseQueueStatus(currentRow.status))
            }
          : null,
        steps
      })
    }

    if (doctorId) {
      const authResult = await requireAuth(req, ['admin', 'doctor'])
      if (authResult instanceof Response) {
        return authResult
      }

      const scopedClinicId = authResult.role === 'doctor' ? (authResult.clinicId || '') : clinicId
      const scopedClinicDbId = toDatabaseClinicId(scopedClinicId, 'male')
      if (!scopedClinicId || (authResult.role === 'doctor' && authResult.doctorId !== doctorId)) {
        return error('Unauthorized doctor scope', 403)
      }

      const { data: clinicRows } = await supabase
        .from(queueTable)
        .select('*')
        .eq(queueSchema.clinicField, scopedClinicDbId)
        .order(queueSchema.orderField, { ascending: true })

      const waitingRows = sortQueueRows((clinicRows || []).filter((row: any) => normaliseQueueStatus(row.status) === 'waiting'), queueSchema)
      const currentRow = (clinicRows || []).find((row: any) => ['called', 'serving'].includes(normaliseQueueStatus(row.status)))
      const completedRows = (clinicRows || []).filter((row: any) => normaliseQueueStatus(row.status) === 'completed')
      const activityTable = await getActivityTable(supabase)
      const absentResponse = activityTable === 'activities'
        ? await supabase
            .from(activityTable)
            .select('*')
            .eq('clinic', scopedClinicId)
            .eq('action', 'patient_skipped')
            .order('timestamp', { ascending: false })
            .limit(20)
        : await supabase
            .from(activityTable)
            .select('*')
            .eq('action_type', 'patient_skipped')
            .order('created_at', { ascending: false })

      const absentActivities = activityTable === 'activities'
        ? (absentResponse.data || [])
        : (absentResponse.data || []).filter((activity: any) => activity.metadata?.clinicId === scopedClinicId).slice(0, 20)

      return success({
        doctor: {
          doctorId,
          clinicId: scopedClinicId,
          clinicName: getClinicName(scopedClinicId),
          displayName: authResult.displayName || authResult.username
        },
        stats: {
          waitingCount: waitingRows.length,
          completedCount: completedRows.length,
          absentCount: absentActivities?.length || 0
        },
        currentPatient: currentRow
          ? {
              patientId: currentRow.patient_id,
              queueNumber: readQueueOrder(currentRow, queueSchema),
              status: normaliseQueueStatus(currentRow.status),
              statusLabel: statusLabel(normaliseQueueStatus(currentRow.status))
            }
          : null,
        waitingPatients: waitingRows.map((row: any) => ({
          patientId: row.patient_id,
          queueNumber: readQueueOrder(row, queueSchema),
          ahead: waitingRows.filter((candidate: any) => readQueueOrder(candidate, queueSchema) < readQueueOrder(row, queueSchema)).length
        })),
        absentPatients: (absentActivities || []).map((activity: any) => ({
          patientId: activity.patient_id || activity.metadata?.patientId,
          loggedAt: activity.timestamp || activity.created_at
        })),
        availableClinics: CLINICS.map((clinic) => ({ id: clinic.id, name: clinic.name }))
      })
    }

    if (!clinicId) {
      return error('Missing clinic parameter', 400)
    }

    const { data: queueList, error: queueError } = await supabase
      .from(queueTable)
      .select('*')
      .eq(queueSchema.clinicField, toDatabaseClinicId(clinicId, 'male'))
      .order(queueSchema.orderField, { ascending: true })

    if (queueError) {
      return error(queueError.message, 500)
    }

    const waitingRows = sortQueueRows((queueList || []).filter((item: any) => normaliseQueueStatus(item.status) === 'waiting'), queueSchema)
    const waitingCount = waitingRows.length
    const completedCount = queueList?.filter((item: any) => normaliseQueueStatus(item.status) === 'completed').length || 0
    const currentRow = queueList?.find((item: any) => ['called', 'serving'].includes(normaliseQueueStatus(item.status)))

    return success({
      clinicId,
      clinicName: getClinicName(clinicId),
      waitingCount,
      completedCount,
      currentPatient: currentRow ? { patientId: currentRow.patient_id, queueNumber: readQueueOrder(currentRow, queueSchema) } : null,
      list: (queueList || []).map((item: any) => ({
        patientId: item.patient_id,
        queueNumber: readQueueOrder(item, queueSchema),
        status: normaliseQueueStatus(item.status)
      }))
    })
  } catch (requestError: any) {
    return error(requestError.message, 500)
  }
}
