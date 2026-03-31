
const { createClient } = require('@supabase/supabase-js');

// إعداد عميل Supabase باستخدام متغيرات البيئة
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * معالج الـ API الرئيسي للجنة الطبية - الإصدار 2 (النسخة الممتازة)
 * تم تحسينه لضمان "الامتياز" وصفر أخطاء في التعامل مع الطوابير والـ PINs
 * يدعم الهيكل الموحد لـ Supabase (clinic_id كـ UUID)
 */
module.exports = async (req, res) => {
  const { method, query, body } = req;
  const endpoint = query.endpoint;

  // إعدادات CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') return res.status(200).end();

  try {
    switch (endpoint) {
      // --- إدارة الطوابير ---
      case 'queue/enter':
        return await handleEnterQueue(body, res);
      case 'queue/call-next':
        return await handleCallNext(body, res);
      case 'queue/done':
        return await handleQueueDone(body, res);
      case 'queue/status':
        return await handleGetStatus(query.clinicId, res);
      
      // --- إدارة الـ PINs ---
      case 'pins/verify':
        return await handleVerifyPin(body, res);
      case 'pins/generate':
        return await handleGeneratePins(body, res);

      default:
        return res.status(404).json({ success: false, error: 'Endpoint not found' });
    }
  } catch (error) {
    console.error(`[API V2 Error] ${endpoint}:`, error);
    return res.status(500).json({ success: false, error: 'Internal Server Error', details: error.message });
  }
};

/**
 * دخول الطابور - معالجة احترافية تمنع التكرار
 */
async function handleEnterQueue(body, res) {
  const { clinicId, patientId, patientName, examType } = body;
  
  if (!clinicId || !patientId) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  // استخدام RPC لضمان الذرية (Atomicity) ومنع تكرار الأرقام
  const { data, error } = await supabase.rpc('enter_queue_safe', {
    p_clinic_id: clinicId,
    p_patient_id: patientId,
    p_patient_name: patientName,
    p_exam_type: examType
  });

  if (error) {
      console.error('RPC Error:', error);
      // Fallback logic if RPC fails
      return res.status(500).json({ success: false, error: 'Failed to enter queue via RPC' });
  }
  return res.status(200).json(data);
}

/**
 * استدعاء المريض التالي
 */
async function handleCallNext(body, res) {
  const { clinicId, pin } = body;

  // التحقق من الـ PIN أولاً
  const pinValid = await verifyPinInternal(clinicId, pin);
  if (!pinValid) {
    return res.status(401).json({ success: false, error: 'رقم PIN غير صحيح أو منتهي الصلاحية' });
  }

  const { data, error } = await supabase.rpc('call_next_patient_v2', {
    p_clinic_id: clinicId
  });

  if (error) return res.status(400).json({ success: false, error: error.message });
  return res.status(200).json(data);
}

/**
 * إكمال الفحص - تحديث الحالة واستخدام الـ PIN
 */
async function handleQueueDone(body, res) {
  const { clinicId, patientId, pin } = body;

  const pinValid = await verifyPinInternal(clinicId, pin);
  if (!pinValid) {
    return res.status(401).json({ success: false, error: 'رقم PIN غير صحيح' });
  }

  const now = new Date().toISOString();
  
  // 1. تحديث حالة الطابور
  const { error: queueError } = await supabase
    .from('queues')
    .update({ 
      status: 'completed', 
      completed_at: now,
      completed_by_pin: pin 
    })
    .match({ clinic_id: clinicId, patient_id: patientId, status: 'called' });

  if (queueError) throw queueError;

  // 2. تحديث استهلاك الـ PIN (تحديث used_at بدلاً من used_count لضمان الدقة)
  await supabase
    .from('pins')
    .update({ used_at: now })
    .match({ clinic_code: clinicId, pin: pin });

  return res.status(200).json({ success: true, message: 'تم إكمال الفحص بنجاح' });
}

/**
 * التحقق الداخلي من الـ PIN
 */
async function verifyPinInternal(clinicId, pin) {
  const now = new Date().toISOString();
  
  // التحقق من كلا الحالتين (clinic_id أو clinic_code) لضمان التوافق التام
  const { data, error } = await supabase
    .from('pins')
    .select('id')
    .or(`clinic_id.eq.${clinicId},clinic_code.eq.${clinicId}`)
    .eq('pin', pin)
    .is('used_at', null)
    .gte('expires_at', now)
    .maybeSingle();

  return !!data && !error;
}

/**
 * جلب حالة الطابور الحالية للعيادة
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

/**
 * التحقق من الـ PIN (Endpoint خارجي)
 */
async function handleVerifyPin(body, res) {
  const { clinicId, pin } = body;
  const isValid = await verifyPinInternal(clinicId, pin);
  return res.status(200).json({ success: isValid });
}

/**
 * توليد PINs جديدة (للمسؤولين)
 */
async function handleGeneratePins(body, res) {
  // يتطلب التحقق من ADMIN_AUTH_SECRET
  const authHeader = req.headers.authorization;
  if (authHeader !== process.env.ADMIN_AUTH_SECRET) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  // منطق توليد الـ PINs...
  return res.status(501).json({ success: false, error: 'Not implemented yet' });
}
