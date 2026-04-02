-- ============================================
-- Unified Queue & Global Numbering Fix
-- توحيد الطابور ونظام الترقيم العالمي
-- ============================================

-- 1) تحديث دالة توليد الرقم العالمي (Global Numbering)
-- تضمن عدم تكرار الأرقام في العيادة الواحدة لنفس اليوم
CREATE OR REPLACE FUNCTION public.generate_pin_safe(p_clinic_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num INTEGER;
  clinic_enabled BOOLEAN;
  system_enabled BOOLEAN;
BEGIN
  -- القفل التنافسي لمنع التكرار اللحظي
  PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id || current_date::text));

  -- الحصول على الرقم التالي من unified_queue (مصدر الحقيقة الواحد)
  SELECT COALESCE(MAX(display_number), 0) + 1
  INTO next_num
  FROM public.unified_queue
  WHERE clinic_id = p_clinic_id
    AND queue_date = CURRENT_DATE;

  -- التحقق من الحد الأقصى (النظام العالمي 9999)
  IF next_num > 9999 THEN
    RAISE EXCEPTION 'MAX_QUEUE_REACHED: تم الوصول للحد الأقصى من الأرقام اليوم';
  END IF;

  RETURN next_num;
END;
$$;

-- 2) تحديث دالة دخول الطابور لتدعم unified_queue وتمنع التكرار
CREATE OR REPLACE FUNCTION public.enter_queue_safe(
  p_clinic_id TEXT,
  p_patient_id TEXT,
  p_patient_name TEXT DEFAULT NULL,
  p_exam_type TEXT DEFAULT 'general'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_num INTEGER;
  v_queue_id UUID;
  v_existing RECORD;
BEGIN
  -- القفل التنافسي على مستوى المريض والعيادة واليوم
  PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id || p_patient_id || current_date::text));

  -- التحقق من وجود المريض في unified_queue اليوم
  SELECT * INTO v_existing
  FROM public.unified_queue
  WHERE clinic_id = p_clinic_id
    AND patient_id = p_patient_id
    AND queue_date = CURRENT_DATE
    AND status IN ('waiting', 'called', 'in_progress', 'serving');

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_IN_QUEUE',
      'clinic', p_clinic_id,
      'user', p_patient_id,
      'number', v_existing.display_number,
      'message', 'المريض موجود بالفعل في الطابور'
    );
  END IF;

  -- توليد الرقم التالي
  v_num := public.generate_pin_safe(p_clinic_id);

  -- إدخال في unified_queue
  INSERT INTO public.unified_queue (
    clinic_id, 
    patient_id, 
    patient_name,
    exam_type,
    display_number, 
    status, 
    queue_date,
    entered_at
  )
  VALUES (
    p_clinic_id, 
    p_patient_id, 
    p_patient_name,
    p_exam_type,
    v_num, 
    'waiting', 
    CURRENT_DATE,
    NOW()
  )
  RETURNING id INTO v_queue_id;

  -- مزامنة مع جدول queues القديم لضمان عدم كسر التوافقية (Legacy Support)
  INSERT INTO public.queues (
    clinic_id, 
    patient_id, 
    display_number, 
    status, 
    queue_date,
    entered_at,
    exam_type
  )
  VALUES (
    p_clinic_id, 
    p_patient_id, 
    v_num, 
    'waiting', 
    CURRENT_DATE,
    NOW(),
    p_exam_type
  ) ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'status', 'OK',
    'clinic', p_clinic_id,
    'user', p_patient_id,
    'number', v_num,
    'message', 'تم الدخول للطابور بنجاح'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'ABORTED', 'reason', SQLERRM);
END;
$$;

-- 3) إزالة الجداول والسياسات المتعلقة بالـ PIN القديم
DROP TABLE IF EXISTS public.pins CASCADE;
DROP TABLE IF EXISTS public.clinic_pins CASCADE;
DROP TABLE IF EXISTS public.kv_pins CASCADE;

-- 4) منح الصلاحيات
GRANT EXECUTE ON FUNCTION public.enter_queue_safe(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_pin_safe(TEXT) TO anon, authenticated;
