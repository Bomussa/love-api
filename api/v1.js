// =============================================================================
// MMC-MMS API v1 — مصدر الحقيقة الوحيد: Supabase
// يُطابق schema قاعدة البيانات الحالية 100%
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,apikey,x-client-info',
};

// توقيت قطر (UTC+3) — يطابق qatar_today() في Supabase
function getQatarDate() {
  return new Date(Date.now() + 3*60*60*1000).toISOString().split('T')[0];
}
function getQatarTime() {
  return new Date(Date.now() + 3*60*60*1000).toISOString();
}

// =============================================================================
// HANDLER الرئيسي
// =============================================================================
export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));
    return res.status(200).end();
  }
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));

  const url    = req.url || '';
  const method = req.method;
  const body   = req.body || {};
  const q      = req.query || {};

  try {

    // =========================================================================
    // 1. HEALTH CHECK
    // =========================================================================
    if (url.includes('/health') || url.includes('/status')) {
      const { count } = await supabase
        .from('unified_queue')
        .select('*', { count:'exact', head:true })
        .eq('queue_date', getQatarDate());
      return res.status(200).json({
        status: 'ok',
        version: 'v5.0.0',
        timestamp: getQatarTime(),
        today: getQatarDate(),
        queue_today: count || 0,
        supabase: 'connected'
      });
    }

    // =========================================================================
    // 2. PATIENT LOGIN — يحفظ أو يُحدّث المريض مع تحديث الجنس دائماً
    // =========================================================================
    if (url.includes('/patient/login') && method === 'POST') {
      const { personalId, gender, examType } = body;
      if (!personalId) return res.status(400).json({ success:false, error:'personalId is required' });

      const genderValue = gender || 'male';

      // بحث أو إنشاء
      let { data: patient } = await supabase
        .from('patients')
        .select('*')
        .eq('personal_id', personalId)
        .maybeSingle();

      if (!patient) {
        const { data: np, error: ce } = await supabase.from('patients').insert({
          personal_id: personalId,
          patient_id:  personalId,
          gender:      genderValue,
          name:        `Patient ${personalId}`,
          status:      'active',
        }).select().single();
        if (ce) throw ce;
        patient = np;
      } else {
        // تحديث الجنس دائماً لضمان صحة البيانات
        await supabase.from('patients')
          .update({ gender: genderValue, updated_at: getQatarTime() })
          .eq('id', patient.id);
        patient = { ...patient, gender: genderValue };
      }

      // قائمة الانتظار النشطة
      const { data: activeQueue } = await supabase
        .from('unified_queue')
        .select('id,clinic_id,display_number,status,exam_type')
        .eq('patient_id', personalId)
        .eq('queue_date', getQatarDate())
        .in('status', ['waiting','called','serving','in_progress'])
        .order('entered_at', { ascending:false })
        .limit(1)
        .maybeSingle();

      return res.status(200).json({ success:true, data:{ ...patient, activeQueue } });
    }

    // =========================================================================
    // 3. QUEUE ENTER — يستخدم enter_queue_safe RPC مع كل المعاملات
    // =========================================================================
    if ((url.includes('/queue/enter') || url.includes('/queue/create')) && method === 'POST') {
      const clinic_id    = body.clinic_id    || body.clinicId;
      const patient_id   = body.patient_id   || body.patientId;
      const exam_type    = body.exam_type    || body.examType  || 'general';
      const patient_name = body.patient_name || body.patientName || patient_id;
      const gender       = body.gender       || 'male';
      const military_id  = body.military_id  || body.militaryId || null;
      const personal_id  = body.personal_id  || body.personalId || patient_id;

      if (!patient_id) return res.status(400).json({ success:false, error:'patient_id is required' });
      if (!clinic_id)  return res.status(400).json({ success:false, error:'clinic_id is required' });

      const { data, error } = await supabase.rpc('enter_queue_safe', {
        p_clinic_id:    clinic_id,
        p_patient_id:   patient_id,
        p_patient_name: patient_name,
        p_exam_type:    exam_type,
        p_gender:       gender,
        p_military_id:  military_id,
        p_personal_id:  personal_id,
      });

      if (error) throw error;
      return res.status(200).json({ success:true, data });
    }

    // =========================================================================
    // 4. QUEUE STATUS / STATS — إحصائيات موحدة
    // =========================================================================
    if ((url.includes('/queue/status') || url.includes('/queue/stats')) && method === 'GET') {
      const clinicId  = q.clinicId  || q.clinic_id;
      const patientId = q.patientId || q.patient_id;
      const date      = q.date || getQatarDate();

      // إحصائيات موحدة عبر get_clinic_stats RPC إذا توفر clinicId
      if (clinicId) {
        const { data: stats, error: se } = await supabase.rpc('get_clinic_stats', {
          p_clinic_id: clinicId,
          p_date:      date,
        });
        if (!se && stats) return res.status(200).json({ success:true, stats });
      }

      // fallback: قراءة مباشرة
      let dbq = supabase.from('unified_queue')
        .select('id,display_number,patient_name,patient_id,status,gender,exam_type,is_vip,is_priority,entered_at,called_at,exam_start_time,completed_at,clinic_id')
        .eq('queue_date', date);
      if (clinicId)  dbq = dbq.eq('clinic_id', clinicId);
      if (patientId) dbq = dbq.eq('patient_id', patientId);
      const { data, error } = await dbq.order('display_number', { ascending:true });
      if (error) throw error;

      const queue = data || [];
      const stats = {
        total:     queue.length,
        waiting:   queue.filter(r => r.status==='waiting').length,
        called:    queue.filter(r => r.status==='called').length,
        serving:   queue.filter(r => ['serving','in_progress'].includes(r.status)).length,
        completed: queue.filter(r => ['completed','done'].includes(r.status)).length,
        absent:    queue.filter(r => ['no_show','absent'].includes(r.status)).length,
        vip:       queue.filter(r => r.is_vip).length,
      };
      return res.status(200).json({ success:true, queue, stats });
    }

    // =========================================================================
    // 5. QUEUE POSITION (للمريض — رقمه وعدد من أمامه)
    // =========================================================================
    if (url.includes('/queue/position') && method === 'GET') {
      const patientId = q.patientId || q.patient_id;
      if (!patientId) return res.status(400).json({ success:false, error:'patientId required' });

      const { data: myEntry } = await supabase
        .from('unified_queue')
        .select('*')
        .eq('patient_id', patientId)
        .eq('queue_date', getQatarDate())
        .in('status', ['waiting','called','serving','in_progress'])
        .order('entered_at', { ascending:false })
        .limit(1).maybeSingle();

      if (!myEntry) return res.status(200).json({ success:true, position:null, entry:null });

      const { count } = await supabase
        .from('unified_queue')
        .select('*', { count:'exact', head:true })
        .eq('clinic_id', myEntry.clinic_id)
        .eq('queue_date', getQatarDate())
        .eq('status','waiting')
        .lt('display_number', myEntry.display_number);

      return res.status(200).json({
        success: true,
        position: (count||0)+1,
        ahead:    count||0,
        entry:    myEntry,
      });
    }

    // =========================================================================
    // 6. DOCTOR LOGIN — يستخدم doctor_login RPC (SECURITY DEFINER, case-insensitive)
    // =========================================================================
    if (url.includes('/doctor/login') && method === 'POST') {
      const { username, password } = body;
      if (!username || !password) return res.status(400).json({ success:false, error:'username and password required' });

      const { data: result, error } = await supabase.rpc('doctor_login', {
        p_username: username,
        p_password: password,
      });
      if (error) throw error;

      if (result?.success) {
        return res.status(200).json({ success:true, data: result.data });
      }
      return res.status(401).json({ success:false, error: result?.message || 'invalid_credentials' });
    }

    // =========================================================================
    // 7. CALL NEXT PATIENT — يستخدم call_next_patient RPC
    // =========================================================================
    if (url.includes('/queue/call-next') && method === 'POST') {
      const clinicId = body.clinicId || body.clinic_id;
      if (!clinicId) return res.status(400).json({ success:false, error:'clinicId required' });

      const { data, error } = await supabase.rpc('call_next_patient', {
        p_clinic_id:         clinicId,
        p_mark_current_done: false,
      });
      if (error) throw error;

      return res.status(200).json({ success:true, data: data?.data || null });
    }

    // =========================================================================
    // 8. START EXAM — يستخدم start_exam_record RPC لحفظ سجل الفحص
    // =========================================================================
    if (url.includes('/queue/start') && method === 'POST') {
      const { queueId, doctorId, doctorName } = body;
      if (!queueId) return res.status(400).json({ success:false, error:'queueId required' });

      const { data, error } = await supabase.rpc('start_exam_record', {
        p_queue_id:    queueId,
        p_doctor_id:   doctorId   || null,
        p_doctor_name: doctorName || null,
      });

      if (error) {
        // fallback مباشر
        const { data: fb, error: fe } = await supabase.from('unified_queue')
          .update({ status:'serving', exam_start_time: getQatarTime(), entered_clinic_at: getQatarTime() })
          .eq('id', queueId).select().single();
        if (fe) throw fe;
        return res.status(200).json({ success:true, data:fb });
      }
      return res.status(200).json({ success:true, data });
    }

    // =========================================================================
    // 9. COMPLETE EXAM — يستخدم finish_exam_record RPC مع حساب المدة
    // =========================================================================
    if (url.includes('/queue/complete') && method === 'POST') {
      const { queueId, result: examResult, notes, status: examStatus } = body;
      if (!queueId) return res.status(400).json({ success:false, error:'queueId required' });

      const { data, error } = await supabase.rpc('finish_exam_record', {
        p_queue_id: queueId,
        p_result:   examResult || null,
        p_notes:    notes      || null,
        p_status:   examStatus || 'completed',
      });

      if (error) {
        // fallback مباشر
        const { data: fb, error: fe } = await supabase.from('unified_queue')
          .update({ status:'done', completed_at: getQatarTime(), exam_end_time: getQatarTime() })
          .eq('id', queueId).select().single();
        if (fe) throw fe;
        return res.status(200).json({ success:true, data:fb });
      }
      return res.status(200).json({ success:true, data });
    }

    // =========================================================================
    // 10. ADVANCE PATIENT ROUTE — ينتقل للعيادة التالية في المسار الطبي
    // =========================================================================
    if (url.includes('/queue/advance') && method === 'POST') {
      const { patientId, clinicId } = body;
      if (!patientId || !clinicId) return res.status(400).json({ success:false, error:'patientId and clinicId required' });

      const { data, error } = await supabase.rpc('advance_patient_route', {
        p_patient_id: patientId,
        p_clinic_id:  clinicId,
      });
      if (error) throw error;
      return res.status(200).json({ success:true, data });
    }

    // =========================================================================
    // 11. ABSENT (MARK NO_SHOW)
    // =========================================================================
    if (url.includes('/queue/absent') && method === 'POST') {
      const { queueId } = body;
      if (!queueId) return res.status(400).json({ success:false, error:'queueId required' });

      // حفظ في exam_records بحالة absent
      await supabase.rpc('finish_exam_record', {
        p_queue_id: queueId,
        p_status:   'absent',
        p_notes:    'تغيب - ' + getQatarTime(),
      }).catch(() => null);

      return res.status(200).json({ success:true, status:'no_show' });
    }

    // =========================================================================
    // 12. QUEUE CANCEL
    // =========================================================================
    if (url.includes('/queue/cancel') && method === 'POST') {
      const { queueId, patientId } = body;
      let upd = supabase.from('unified_queue').update({ status:'cancelled' });
      if (queueId)  upd = upd.eq('id', queueId);
      else if (patientId) upd = upd.eq('patient_id', patientId).eq('queue_date', getQatarDate());
      else return res.status(400).json({ success:false, error:'queueId or patientId required' });
      const { error } = await upd;
      if (error) throw error;
      return res.status(200).json({ success:true });
    }

    // =========================================================================
    // 13. CLINICS — جلب العيادات النشطة
    // =========================================================================
    if (url.includes('/clinics') && method === 'GET') {
      const { data, error } = await supabase
        .from('clinics')
        .select('id,name,name_ar,name_en,floor,category,gender_constraint,is_active,exam_duration')
        .eq('is_active', true)
        .order('name_ar');
      if (error) throw error;
      return res.status(200).json({ success:true, data });
    }

    // =========================================================================
    // 14. SETTINGS — من system_settings (المصدر الحقيقي)
    // =========================================================================
    if (url.includes('/settings') && method === 'GET') {
      const { data, error } = await supabase.from('system_settings').select('*');
      if (error) throw error;
      // تحويل إلى كائن key→value لسهولة الاستخدام
      const settings = {};
      (data||[]).forEach(s => {
        try { settings[s.key || s.id] = JSON.parse(s.value); }
        catch { settings[s.key || s.id] = s.value; }
      });
      return res.status(200).json({ success:true, data, settings });
    }

    // =========================================================================
    // 15. ROUTES — مسارات الفحص الطبي
    // =========================================================================
    if (url.includes('/routes') && method === 'GET') {
      const examType = q.examType || q.exam_type;
      let dbq = supabase.from('routes').select('*').eq('is_active', true);
      if (examType) dbq = dbq.eq('exam_type', examType);
      const { data, error } = await dbq.order('order_sequence');
      if (error) throw error;
      return res.status(200).json({ success:true, data });
    }

    // =========================================================================
    // 16. EXAM RECORDS — سجلات الفحص لمريض أو عيادة
    // =========================================================================
    if (url.includes('/exam-records') && method === 'GET') {
      const patientId = q.patientId || q.patient_id;
      const clinicId  = q.clinicId  || q.clinic_id;
      const date      = q.date || getQatarDate();

      let dbq = supabase.from('exam_records').select('*').eq('exam_date', date);
      if (patientId) dbq = dbq.eq('patient_id', patientId);
      if (clinicId)  dbq = dbq.eq('clinic_id', clinicId);
      const { data, error } = await dbq.order('start_time', { ascending:false }).limit(100);
      if (error) throw error;
      return res.status(200).json({ success:true, data });
    }

    // =========================================================================
    // 17. SMART HEALTH CHECK
    // =========================================================================
    if (url.includes('/health/check') && method === 'GET') {
      const { data, error } = await supabase.rpc('run_smart_health_check');
      if (error) throw error;
      return res.status(200).json({ success:true, data });
    }

    // =========================================================================
    // 18. SMART AUTO REPAIR
    // =========================================================================
    if (url.includes('/health/repair') && method === 'POST') {
      const { data, error } = await supabase.rpc('run_smart_auto_repair');
      if (error) throw error;
      return res.status(200).json({ success:true, data });
    }

    // =========================================================================
    // 19. CLINIC STATS (موحد)
    // =========================================================================
    if (url.includes('/stats') && method === 'GET') {
      const clinicId = q.clinicId || q.clinic_id;
      const date     = q.date || getQatarDate();
      if (!clinicId) return res.status(400).json({ success:false, error:'clinicId required' });
      const { data, error } = await supabase.rpc('get_clinic_stats', { p_clinic_id: clinicId, p_date: date });
      if (error) throw error;
      return res.status(200).json({ success:true, data });
    }

    // =========================================================================
    // 404 — endpoint غير معروف
    // =========================================================================
    return res.status(404).json({ success:false, error:'Endpoint not found', url });

  } catch (err) {
    console.error('[API Error]', url, err.message);
    return res.status(500).json({ success:false, error: err.message || 'Internal error' });
  }
}
