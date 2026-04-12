-- Backend Improvements for MMC-MMS
-- 1. Database Trigger for automatic display_number generation
-- 2. Row Level Security (RLS) for clinic-based access
-- 3. Stored Procedures (RPC) for atomic queue operations
-- 4. Optimized Indexes

BEGIN;

-- 1. Automatic display_number generation
CREATE OR REPLACE FUNCTION public.generate_queue_display_number()
RETURNS TRIGGER AS $$
DECLARE
    next_num INTEGER;
BEGIN
    IF NEW.display_number IS NULL OR NEW.display_number = 0 THEN
        SELECT COALESCE(MAX(display_number), 0) + 1
        INTO next_num
        FROM public.queues
        WHERE clinic_id = NEW.clinic_id 
          AND queue_date = NEW.queue_date;
        
        NEW.display_number := next_num;
        NEW.queue_number_int := next_num;
        NEW.queue_number := next_num::TEXT;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_display_number ON public.queues;
CREATE TRIGGER trg_generate_display_number
BEFORE INSERT ON public.queues
FOR EACH ROW
EXECUTE FUNCTION public.generate_queue_display_number();

-- 2. Row Level Security (RLS)
-- Ensure RLS is enabled
ALTER TABLE public.queues ENABLE ROW LEVEL SECURITY;

-- Policy: Doctors can only update patients in their own clinic
DROP POLICY IF EXISTS "Doctors can update their own clinic queues" ON public.queues;
CREATE POLICY "Doctors can update their own clinic queues"
ON public.queues
FOR UPDATE
USING (
    clinic_id IN (
        SELECT clinic_id FROM public.doctors WHERE id = auth.uid()
    )
)
WITH CHECK (
    clinic_id IN (
        SELECT clinic_id FROM public.doctors WHERE id = auth.uid()
    )
);

-- 3. Stored Procedures (RPC) for Atomic Priority Call
CREATE OR REPLACE FUNCTION public.priority_call_patient(p_clinic_id UUID, p_patient_id TEXT, p_patient_name TEXT)
RETURNS JSONB AS $$
DECLARE
    v_queue_id UUID;
    v_display_num INTEGER;
BEGIN
    -- Get next display number
    SELECT COALESCE(MAX(display_number), 0) + 1
    INTO v_display_num
    FROM public.queues
    WHERE clinic_id = p_clinic_id 
      AND queue_date = CURRENT_DATE;

    -- Insert as called immediately (Priority)
    INSERT INTO public.queues (
        clinic_id,
        patient_id,
        patient_name,
        status,
        display_number,
        queue_number_int,
        queue_number,
        queue_date,
        called_at
    ) VALUES (
        p_clinic_id,
        p_patient_id,
        p_patient_name,
        'called',
        v_display_num,
        v_display_num,
        v_display_num::TEXT,
        CURRENT_DATE,
        NOW()
    )
    RETURNING id INTO v_queue_id;

    RETURN jsonb_build_object(
        'success', true,
        'queue_id', v_queue_id,
        'display_number', v_display_num
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Optimized Indexes
CREATE INDEX IF NOT EXISTS idx_queues_composite_lookup 
ON public.queues (clinic_id, queue_date, status, display_number);

COMMIT;
