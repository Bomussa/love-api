BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_queues_active_patient_per_clinic_day
ON public.queues (clinic_id, patient_id, queue_date)
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
  v_next_display_number integer;
  v_row public.queues;
BEGIN
  SELECT COALESCE(MAX(q.display_number), 0) + 1
    INTO v_next_display_number
  FROM public.queues q
  WHERE q.clinic_id = p_clinic_id
    AND q.queue_date = CURRENT_DATE
  FOR UPDATE;

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
  VALUES (
    btrim(p_patient_id),
    btrim(p_clinic_id),
    nullif(btrim(p_exam_type), ''),
    'WAITING',
    v_next_display_number,
    v_next_display_number::text,
    coalesce(p_is_priority, false),
    nullif(btrim(p_priority_reason), ''),
    CURRENT_DATE,
    now()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'QUEUE_CONFLICT_RETRYABLE',
      DETAIL = 'A queue row already exists for this patient/clinic/date in active statuses.';
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_to_queue_atomic(text, text, text, boolean, text)
TO anon, authenticated, service_role;

COMMIT;
