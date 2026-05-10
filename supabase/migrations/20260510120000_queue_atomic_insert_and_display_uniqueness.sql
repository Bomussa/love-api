BEGIN;

-- Enforce display number uniqueness per clinic among active queue rows.
-- This aligns with contracts that treat display_number as the active ticket identifier.
CREATE UNIQUE INDEX IF NOT EXISTS idx_queues_clinic_display_number_active_unique
ON public.queues (clinic_id, display_number)
WHERE status IN ('WAITING', 'CALLED', 'IN_PROGRESS');

CREATE OR REPLACE FUNCTION public.add_to_queue_atomic(
  p_patient_id text,
  p_clinic_id text,
  p_exam_type text default null,
  p_is_priority boolean default false,
  p_priority_reason text default null
)
RETURNS public.queues
LANGUAGE plpgsql
AS $$
DECLARE
  v_clinic_id text := btrim(p_clinic_id);
  v_patient_id text := btrim(p_patient_id);
  v_today date := CURRENT_DATE;
  v_row public.queues;
BEGIN
  IF v_patient_id IS NULL OR v_patient_id = '' OR v_clinic_id IS NULL OR v_clinic_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'patient_id and clinic_id are required';
  END IF;

  -- Serialize allocation within a clinic/day to avoid duplicate display numbers under concurrency.
  PERFORM pg_advisory_xact_lock(hashtext(format('%s|%s', v_clinic_id, v_today::text)));

  INSERT INTO public.queues (
    patient_id,
    clinic_id,
    exam_type,
    status,
    display_number,
    queue_number,
    is_priority,
    priority_reason,
    queue_date,
    entered_at
  )
  SELECT
    v_patient_id,
    v_clinic_id,
    nullif(btrim(p_exam_type), ''),
    'WAITING',
    COALESCE(MAX(q.display_number), 0) + 1,
    (COALESCE(MAX(q.display_number), 0) + 1)::text,
    COALESCE(p_is_priority, false),
    nullif(btrim(p_priority_reason), ''),
    v_today,
    now()
  FROM public.queues q
  WHERE q.clinic_id = v_clinic_id
    AND q.queue_date = v_today
  RETURNING * INTO v_row;

  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'QUEUE_CONFLICT_RETRYABLE',
      DETAIL = 'Queue uniqueness constraint hit. Caller may retry add_to_queue_atomic once.';
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_to_queue_atomic(text, text, text, boolean, text)
TO anon, authenticated, service_role;

COMMIT;
