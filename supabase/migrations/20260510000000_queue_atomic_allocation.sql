-- Ensure queue display numbers are unique inside each clinic.
create unique index if not exists queues_clinic_id_display_number_uniq
  on public.queues (clinic_id, display_number);

-- Atomically assign display_number and insert queue row.
create or replace function public.add_to_queue_atomic(
  p_patient_id text,
  p_clinic_id text,
  p_exam_type text default null,
  p_is_priority boolean default false,
  p_priority_reason text default null
)
returns public.queues
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_display_number integer;
  v_row public.queues;
begin
  if p_patient_id is null or btrim(p_patient_id) = '' then
    raise exception 'patient_id is required' using errcode = '22023';
  end if;

  if p_clinic_id is null or btrim(p_clinic_id) = '' then
    raise exception 'clinic_id is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_clinic_id), 0));

  select coalesce(max(display_number), 0) + 1
    into v_next_display_number
  from public.queues
  where clinic_id = btrim(p_clinic_id);

  insert into public.queues (
    patient_id,
    clinic_id,
    exam_type,
    status,
    display_number,
    is_priority,
    priority_reason,
    entered_at
  ) values (
    btrim(p_patient_id),
    btrim(p_clinic_id),
    nullif(btrim(p_exam_type), ''),
    'WAITING',
    v_next_display_number,
    coalesce(p_is_priority, false),
    nullif(btrim(p_priority_reason), ''),
    now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.add_to_queue_atomic(text, text, text, boolean, text) to anon, authenticated, service_role;
