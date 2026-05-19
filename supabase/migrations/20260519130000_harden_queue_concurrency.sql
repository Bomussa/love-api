BEGIN;

-- 1. RPC لتسجيل دخول المراجع بشكل آمن وذري
CREATE OR REPLACE FUNCTION public.patient_login_safe(
  p_personal_id text,
  p_gender text DEFAULT 'male'
)
RETURNS public.patients
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_patient public.patients;
BEGIN
  -- محاولة الحصول على المراجع
  SELECT * INTO v_patient FROM public.patients WHERE personal_id = p_personal_id;
  
  IF NOT FOUND THEN
    -- إنشاء مراجع جديد إذا لم يوجد
    INSERT INTO public.patients (personal_id, gender, status, name, created_at, updated_at)
    VALUES (p_personal_id, p_gender, 'active', 'Patient ' || p_personal_id, now(), now())
    RETURNING * INTO v_patient;
  ELSE
    -- تحديث الجنس إذا اختلف
    IF v_patient.gender != p_gender THEN
      UPDATE public.patients 
      SET gender = p_gender, updated_at = now() 
      WHERE personal_id = p_personal_id
      RETURNING * INTO v_patient;
    END IF;
  END IF;
  
  RETURN v_patient;
END;
$$;

-- 2. RPC لدخول الطابور مع قفل تنافسي (Concurrency Lock)
CREATE OR REPLACE FUNCTION public.enter_queue_safe_v2(
    p_clinic_id TEXT,
    p_patient_id TEXT,
    p_patient_name TEXT DEFAULT NULL,
    p_exam_type TEXT DEFAULT NULL,
    p_gender TEXT DEFAULT 'male',
    p_military_id TEXT DEFAULT NULL,
    p_personal_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := CURRENT_DATE;
    v_last_number INTEGER;
    v_new_number INTEGER;
    v_existing_id UUID;
    v_existing_number INTEGER;
    v_lock_key TEXT;
BEGIN
    -- مفتاح القفل بناءً على العيادة والتاريخ
    v_lock_key := 'queue_lock_' || p_clinic_id || '_' || v_today::text;
    
    -- الحصول على قفل استشاري لضمان عدم التكرار
    PERFORM pg_advisory_xact_lock(hashtext(v_lock_key));

    -- 1. التحقق مما إذا كان المراجع موجوداً بالفعل في الطابور لهذه العيادة اليوم
    SELECT id, display_number INTO v_existing_id, v_existing_number
    FROM public.unified_queue
    WHERE clinic_id = p_clinic_id
      AND (patient_id = p_patient_id OR personal_id = p_personal_id)
      AND queue_date = v_today
      AND status IN ('waiting', 'called', 'serving', 'in_progress')
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'id', v_existing_id,
            'display_number', v_existing_number,
            'status', 'ALREADY_IN_QUEUE',
            'success', true
        );
    END IF;

    -- 2. الحصول على الرقم التالي بأمان
    SELECT COALESCE(MAX(display_number), 0) INTO v_last_number
    FROM public.unified_queue
    WHERE clinic_id = p_clinic_id
      AND queue_date = v_today;

    v_new_number := v_last_number + 1;

    -- 3. إدراج مراجع جديد
    INSERT INTO public.unified_queue (
        clinic_id,
        patient_id,
        personal_id,
        military_id,
        patient_name,
        exam_type,
        gender,
        display_number,
        status,
        queue_date,
        entered_at
    )
    VALUES (
        p_clinic_id,
        p_patient_id,
        COALESCE(p_personal_id, p_patient_id),
        p_military_id,
        COALESCE(p_patient_name, 'Patient ' || p_patient_id),
        p_exam_type,
        p_gender,
        v_new_number,
        'waiting',
        v_today,
        NOW()
    )
    RETURNING id INTO v_existing_id;

    RETURN jsonb_build_object(
        'id', v_existing_id,
        'display_number', v_new_number,
        'status', 'OK',
        'success', true
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM,
            'status', 'ERROR'
        );
END;
$$;

-- 3. تفعيل الـ Kill Switch (System Config)
INSERT INTO public.system_settings (id, value, description)
VALUES ('system_enabled', 'true', 'Main system kill switch')
ON CONFLICT (id) DO UPDATE SET value = 'true';

COMMIT;
