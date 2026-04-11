import {
  appendActivity,
  CLINICS,
  createSupabaseServerClient,
  error,
  getDoctorRecords,
  getQueueSchema,
  handleCORSPreflight,
  normaliseQueueStatus,
  parseRequestBody,
  readQueueClinic,
  readQueueOrder,
  readEnv,
  requireAuth,
  sha256,
  signAuthToken,
  sortQueueRows,
  toDatabaseClinicId,
  success
} from '../../_lib/json'

export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return handleCORSPreflight()
  }

  try {
    const supabase = createSupabaseServerClient()
    const queueSchema = await getQueueSchema(supabase)
    const queueTable = queueSchema.table

    if (req.method === 'POST') {
      const body = await parseRequestBody<any>(req)
      const action = body?.action || ''

      if (action === 'admin_login') {
        const adminUsername = readEnv('ADMIN_AUTH_USERNAME') || 'admin'
        const adminPassword = readEnv('ADMIN_AUTH_SECRET')

        if (!adminPassword) {
          return error('ADMIN_AUTH_SECRET is missing', 500)
        }

        if (body.username !== adminUsername || body.password !== adminPassword) {
          return error('Invalid administrator credentials', 401)
        }

        return success({
          token: await signAuthToken({ role: 'admin', username: adminUsername }),
          username: adminUsername
        })
      }

      if (action === 'doctor_login') {
        const doctorRecords = await getDoctorRecords(supabase)
        const doctor = doctorRecords.find((record) => record.username === body.username)

        if (!doctor) {
          return error('Doctor account not found', 404)
        }

        if (doctor.isFrozen) {
          return error('Doctor account is frozen', 403)
        }

        const incomingHash = await sha256(body.password || '')
        if (incomingHash !== doctor.passwordHash) {
          return error('Invalid doctor credentials', 401)
        }

        return success({
          token: await signAuthToken({
            role: 'doctor',
            username: doctor.username,
            doctorId: doctor.id,
            clinicId: doctor.clinicId,
            displayName: doctor.displayName
          }),
          doctorId: doctor.id,
          username: doctor.username,
          displayName: doctor.displayName,
          clinicId: doctor.clinicId,
          clinicName: doctor.clinicName
        })
      }

      const authResult = await requireAuth(req, ['admin'])
      if (authResult instanceof Response) {
        return authResult
      }

      const doctorRecords = await getDoctorRecords(supabase)
      const currentDoctor = doctorRecords.find((record) => record.id === body.doctorId)

      if (action === 'create_doctor') {
        const { username, password, clinicId, displayName } = body
        if (!username || !password || !clinicId || !displayName) {
          return error('displayName, username, password, and clinicId are required', 400)
        }

        if (doctorRecords.some((doctor) => doctor.username === username)) {
          return error('Doctor username already exists', 409)
        }

        const doctorId = `d${Date.now().toString().slice(-11)}`
        await appendActivity(supabase, {
          patientId: doctorId,
          clinicId,
          action: 'doctor_account',
          details: {
            doctorId,
            username,
            clinicId,
            displayName,
            passwordHash: await sha256(password),
            isFrozen: false,
            isDeleted: false
          }
        })

        return success({ doctorId })
      }

      if (!currentDoctor) {
        return error('Doctor account not found', 404)
      }

      if (action === 'update_doctor_password') {
        if (!body.password) {
          return error('password is required', 400)
        }

        await appendActivity(supabase, {
          patientId: currentDoctor.id,
          clinicId: currentDoctor.clinicId,
          action: 'doctor_account',
          details: {
            ...currentDoctor,
            passwordHash: await sha256(body.password),
            isDeleted: false
          }
        })

        return success({ doctorId: currentDoctor.id })
      }

      if (action === 'toggle_doctor_freeze') {
        await appendActivity(supabase, {
          patientId: currentDoctor.id,
          clinicId: currentDoctor.clinicId,
          action: 'doctor_account',
          details: {
            ...currentDoctor,
            isFrozen: !currentDoctor.isFrozen,
            isDeleted: false
          }
        })

        return success({ doctorId: currentDoctor.id, isFrozen: !currentDoctor.isFrozen })
      }

      if (action === 'delete_doctor') {
        await appendActivity(supabase, {
          patientId: currentDoctor.id,
          clinicId: currentDoctor.clinicId,
          action: 'doctor_account',
          details: {
            ...currentDoctor,
            isDeleted: true
          }
        })

        return success({ doctorId: currentDoctor.id })
      }

      return error('Unsupported admin action', 400)
    }

    const authResult = await requireAuth(req, ['admin'])
    if (authResult instanceof Response) {
      return authResult
    }

    const { data: queueRows, error: queueError } = await supabase
      .from(queueTable)
      .select('*')
      .order(queueSchema.clinicField, { ascending: true })
      .order(queueSchema.orderField, { ascending: true })

    if (queueError) {
      return error(queueError.message, 500)
    }

    const { count: patientCount } = await supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })

    const doctors = await getDoctorRecords(supabase)
    const clinics = CLINICS.map((clinic) => {
      const rows = (queueRows || []).filter((row: any) => readQueueClinic(row, queueSchema) === toDatabaseClinicId(clinic.id))
      const waitingRows = sortQueueRows(rows.filter((row: any) => normaliseQueueStatus(row.status) === 'waiting'), queueSchema)
      const currentRow = rows.find((row: any) => ['called', 'serving'].includes(normaliseQueueStatus(row.status)))
      const completedRows = rows.filter((row: any) => normaliseQueueStatus(row.status) === 'completed')

      return {
        id: clinic.id,
        name: clinic.name,
        waitingCount: waitingRows.length,
        completedCount: completedRows.length,
        currentPatient: currentRow
          ? {
              patientId: currentRow.patient_id,
              queueNumber: readQueueOrder(currentRow, queueSchema),
              status: normaliseQueueStatus(currentRow.status)
            }
          : null
      }
    })

    const completedDurations = (queueRows || [])
      .filter((row: any) => row.called_at && row.completed_at)
      .map((row: any) => {
        const start = new Date(row.called_at).getTime()
        const end = new Date(row.completed_at).getTime()
        return Math.max(0, Math.round((end - start) / 60000))
      })

    return success({
      overview: {
        totalPatients: patientCount || 0,
        waitingCount: clinics.reduce((total, clinic) => total + clinic.waitingCount, 0),
        completedCount: clinics.reduce((total, clinic) => total + clinic.completedCount, 0),
        avgWaitMinutes: completedDurations.length
          ? Math.round(completedDurations.reduce((total, value) => total + value, 0) / completedDurations.length)
          : 0
      },
      clinics,
      doctors
    })
  } catch (requestError: any) {
    return error(requestError.message, 500)
  }
}
