do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'patient_routes'
  ) then
    alter table if exists public.patient_routes
      add column if not exists updated_at timestamptz default now();

    create unique index if not exists idx_patient_routes_patient_id_unique
      on public.patient_routes (patient_id);

    create index if not exists idx_patient_routes_exam_type
      on public.patient_routes (exam_type);

    create index if not exists idx_patient_routes_updated_at
      on public.patient_routes (updated_at desc);
  end if;
end $$;
