-- Atomic queue insertion via RPC + uniqueness safeguards

create unique index if not exists idx_queues_active_patient_unique
  on public.queues (clinic_id, patient_id)
  where lower(status) in ('waiting', 'in_progress', 'called', 'serving');

create unique index if not exists idx_queues_clinic_display_number_active_unique
  on public.queues (clinic_id, display_number)
  where lower(status) in ('waiting', 'in_progress', 'called', 'serving');

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
  v_next_number integer;
  v_row public.queues;
begin
  if p_patient_id is null or btrim(p_patient_id) = '' or p_clinic_id is null or btrim(p_clinic_id) = '' then
    raise exception using
      errcode = '22023',
      message = 'patient_id and clinic_id are required';
  end if;

  perform pg_advisory_xact_lock(hashtext('queues_next_number:' || btrim(p_clinic_id)));

  select coalesce(max(q.display_number), 0) + 1
    into v_next_number
  from public.queues q
  where q.clinic_id = btrim(p_clinic_id)
    and lower(q.status) in ('waiting', 'in_progress', 'called', 'serving');

  insert into public.queues (
    patient_id,
    clinic_id,
    exam_type,
    status,
    display_number,
    is_priority,
    priority_reason,
    entered_at
  )
  values (
    btrim(p_patient_id),
    btrim(p_clinic_id),
    nullif(btrim(p_exam_type), ''),
    'WAITING',
    v_next_number,
    coalesce(p_is_priority, false),
    nullif(btrim(p_priority_reason), ''),
    now()
  )
  returning * into v_row;

  return v_row;
end;
$$;
