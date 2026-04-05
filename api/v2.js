
/**
 * API v2 - PIN System DISABLED
 * ⚠️ نظام PIN تم إلغاؤه نهائياً - جميع endpoints المتعلقة بالـ PIN معطلة
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  const { method, query, body } = req;
  const endpoint = query.endpoint;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') return res.status(200).end();

  try {
    switch (endpoint) {
      // --- Queue Management ---
      case 'queue/enter':
        return await handleEnterQueue(body, res);
      case 'queue/call-next':
        return await handleCallNext(body, res);
      case 'queue/done':
        return await handleQueueDone(body, res);
      case 'queue/status':
        return await handleGetStatus(query.clinicId, res);

      // --- PIN endpoints (DISABLED) ---
      case 'pins/verify':
      case 'pins/generate':
        return res.status(410).json({
          success: false,
          error: 'PIN system permanently removed',
          code: 'PIN_REMOVED'
        });

      default:
        return res.status(404).json({ success: false, error: 'Endpoint not found' });
    }
  } catch (error) {
    console.error(`[API V2 Error] ${endpoint}:`, error);
    return res.status(500).json({ success: false, error: 'Internal Server Error', details: error.message });
  }
};

/**
 * Queue Entry - No PIN required
 */
async function handleEnterQueue(body, res) {
  const { clinicId, patientId, patientName, examType } = body;

  if (!clinicId || !patientId) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const { data, error } = await supabase.rpc('enter_queue_safe', {
    p_clinic_id: clinicId,
    p_patient_id: patientId,
    p_patient_name: patientName,
    p_exam_type: examType
  });

  if (error) {
    console.error('RPC Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to enter queue via RPC' });
  }
  return res.status(200).json(data);
}

/**
 * Call Next Patient - No PIN required
 */
async function handleCallNext(body, res) {
  const { clinicId } = body;

  // PIN verification REMOVED - doctors can call without PIN
  console.log('[API v2] Call next patient - PIN verification disabled');

  const { data, error } = await supabase.rpc('call_next_patient_v2', {
    p_clinic_id: clinicId
  });

  if (error) return res.status(400).json({ success: false, error: error.message });
  return res.status(200).json(data);
}

/**
 * Complete Exam - No PIN required
 */
async function handleQueueDone(body, res) {
  const { clinicId, patientId } = body;

  // PIN verification REMOVED
  console.log('[API v2] Queue done - PIN verification disabled');

  const now = new Date().toISOString();

  const { error: queueError } = await supabase
    .from('queues')
    .update({
      status: 'completed',
      completed_at: now,
    })
    .match({ clinic_id: clinicId, patient_id: patientId, status: 'called' });

  if (queueError) throw queueError;

  return res.status(200).json({ success: true, message: 'تم إكمال الفحص بنجاح' });
}

/**
 * Get Queue Status
 */
async function handleGetStatus(clinicId, res) {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('queues')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('queue_date', today)
    .order('display_number', { ascending: true });

  if (error) throw error;
  return res.status(200).json({ success: true, queue: data });
}
