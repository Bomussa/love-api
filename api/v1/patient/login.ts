import {
  appendActivity,
  createSupabaseServerClient,
  error,
  getPatientRouteState,
  getQueueSchema,
  handleCORSPreflight,
  parseRequestBody,
  readQueueClinic,
  readQueueOrder,
  savePatientRouteState,
  toDatabaseClinicId,
  success
} from '../../_lib/json'

export const config = { runtime: 'edge' }

// Sync with frontend utils.js medicalPathways
const MEDICAL_PATHWAYS: any = {
  courses: {
    male: ['lab', 'vitals', 'eyes', 'internal', 'surgery', 'bones', 'ent'],
    female: ['lab', 'vitals', 'ent', 'surgery', 'bones', 'psychiatry', 'dental', 'internal', 'eyes', 'derma']
  },
  recruitment: {
    male: ['lab', 'vitals', 'eyes', 'internal', 'surgery', 'bones', 'ent', 'psychiatry', 'dental'],
    female: ['lab', 'vitals', 'ent', 'surgery', 'bones', 'psychiatry', 'dental', 'internal', 'eyes', 'derma']
  },
  promotion: {
    male: ['lab', 'vitals', 'eyes', 'internal', 'surgery', 'bones', 'ent', 'psychiatry', 'dental'],
    female: ['lab', 'vitals', 'ent', 'surgery', 'bones', 'psychiatry', 'dental', 'internal', 'eyes', 'derma']
  },
  transfer: {
    male: ['lab', 'vitals', 'eyes', 'internal', 'surgery', 'bones', 'ent', 'psychiatry', 'dental'],
    female: ['lab', 'vitals', 'ent', 'surgery', 'bones', 'psychiatry', 'dental', 'internal', 'eyes', 'derma']
  },
  referral: {
    male: ['lab', 'vitals', 'eyes', 'internal', 'surgery', 'bones', 'ent', 'psychiatry', 'dental'],
    female: ['lab', 'vitals', 'ent', 'surgery', 'bones', 'psychiatry', 'dental', 'internal', 'eyes', 'derma']
  },
  contract: {
    male: ['lab', 'vitals', 'eyes', 'internal', 'surgery', 'bones', 'ent', 'psychiatry', 'dental'],
    female: ['lab', 'vitals', 'ent', 'surgery', 'bones', 'psychiatry', 'dental', 'internal', 'eyes', 'derma']
  },
  aviation: {
    male: ['lab', 'eyes', 'internal', 'ent', 'ecg', 'audio'],
    female: ['lab', 'ent', 'surgery', 'bones', 'psychiatry', 'dental', 'internal', 'eyes', 'derma']
  },
  cooks: {
    male: ['lab', 'internal', 'ent', 'surgery'],
    female: ['lab', 'vitals', 'ent', 'surgery', 'bones', 'psychiatry', 'dental', 'internal', 'eyes', 'derma']
  }
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return handleCORSPreflight()
  }

  if (req.method !== 'POST') {
    return error('Method not allowed', 405)
  }

  try {
    const body = await parseRequestBody<{ patientId?: string; gender?: string; examType?: string }>(req)
    const { patientId = '', gender = '', examType = 'recruitment' } = body

    if (!patientId || !gender) {
      return error('Missing required fields: patientId and gender', 400)
    }

    if (!/^\d{2,12}$/.test(patientId)) {
      return error('Invalid patientId format. Must be 2-12 digits.', 400)
    }

    if (!['male', 'female'].includes(gender)) {
      return error('Invalid gender. Must be "male" or "female".', 400)
    }

    const supabase = createSupabaseServerClient()
    const queueSchema = await getQueueSchema(supabase)
    const queueTable = queueSchema.table

    const pathways = MEDICAL_PATHWAYS[examType] || MEDICAL_PATHWAYS.recruitment
    const route = pathways[gender] || pathways.male
    const savedRouteState = await getPatientRouteState(supabase, patientId)

    const { data: existingPatient } = await supabase
      .from('patients')
      .select('*')
      .eq('patient_id', patientId)
      .maybeSingle()

    const patientData = {
      patient_id: patientId,
      gender,
      status: 'active',
      login_time: existingPatient?.login_time || new Date().toISOString(),
      session_id: existingPatient?.session_id || null,
      updated_at: new Date().toISOString()
    }

    const { error: upsertError } = await supabase
      .from('patients')
      .upsert(patientData, { onConflict: 'patient_id' });

    if (upsertError) {
      return error(upsertError.message, 500)
    }

    let activeClinic = savedRouteState?.currentClinic || route[0]
    let activeClinicDbId = toDatabaseClinicId(activeClinic, gender)
    let activeIndex = typeof savedRouteState?.currentIndex === 'number' ? savedRouteState.currentIndex : 0

    const { data: activePatientQueueRow } = await supabase
      .from(queueTable)
      .select('*')
      .eq('patient_id', patientId)
      .in('status', ['waiting', 'called'])
      .order(queueSchema.orderField, { ascending: false })
      .limit(1)
      .maybeSingle()

    if (activePatientQueueRow) {
      activeClinicDbId = readQueueClinic(activePatientQueueRow, queueSchema)
      activeClinic = route.find((clinicId) => toDatabaseClinicId(clinicId, gender) === activeClinicDbId) || activeClinic
      activeIndex = Math.max(0, route.indexOf(activeClinic))
    }

    const { data: existingQueueRow } = await supabase
      .from(queueTable)
      .select('*')
      .eq(queueSchema.clinicField, activeClinicDbId)
      .eq('patient_id', patientId)
      .in('status', ['waiting', 'called'])
      .maybeSingle()

    let queueNumber = existingQueueRow ? readQueueOrder(existingQueueRow, queueSchema) : null

    if (!existingQueueRow) {
      const { data: lastQueueRow } = await supabase
        .from(queueTable)
        .select(queueSchema.orderField)
        .eq(queueSchema.clinicField, activeClinicDbId)
        .order(queueSchema.orderField, { ascending: false })
        .limit(1)
        .maybeSingle()

      queueNumber = (readQueueOrder(lastQueueRow || {}, queueSchema) || 0) + 1

      const { error: queueInsertError } = await supabase.from(queueTable).insert({
        [queueSchema.clinicField]: activeClinicDbId,
        patient_id: patientId,
        patient_name: existingPatient?.name || patientId,
        [queueSchema.orderField]: queueNumber,
        [queueSchema.examField]: examType,
        status: 'waiting',
        entered_at: new Date().toISOString()
      })

      if (queueInsertError) {
        const { data: fallbackQueueRow } = await supabase
          .from(queueTable)
          .select('*')
          .eq('patient_id', patientId)
          .eq(queueSchema.clinicField, activeClinicDbId)
          .in('status', ['waiting', 'called'])
          .order(queueSchema.orderField, { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!fallbackQueueRow) {
          return error(queueInsertError.message, 500)
        }

        queueNumber = readQueueOrder(fallbackQueueRow, queueSchema)
      } else {
        await appendActivity(supabase, {
          patientId,
          clinicId: activeClinic,
          action: 'patient_waiting',
          details: { queueNumber, examType, route }
        })
      }
    }

    await savePatientRouteState(supabase, {
      patientId,
      route,
      currentIndex: activeIndex,
      currentClinic: activeClinic,
      examType,
      status: 'waiting',
      gender
    })

    return success({
      patientId,
      gender,
      examType,
      route,
      firstClinic: route[0],
      currentClinic: activeClinic,
      currentIndex: activeIndex,
      queueNumber,
      totalClinics: route.length
    })
  } catch (requestError: any) {
    return error(requestError.message, 500)
  }
}
