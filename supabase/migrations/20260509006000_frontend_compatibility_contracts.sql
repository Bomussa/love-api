-- Frontend compatibility contracts
-- Unify the DB contracts used by the active frontend screens.

create extension if not exists "uuid-ossp";

-- ============================================================================
-- system_settings: add id alias for frontend code that still reads/writes id
-- ============================================================================
alter table if exists public.system_settings
    add column if not exists id text;

update public.system_settings
   set id = coalesce(id, key)
 where id is null;

create unique index if not exists idx_system_settings_id on public.system_settings (id);

create or replace function public.sync_system_settings_compat()
returns trigger
language plpgsql
as $$
begin
    new.id := coalesce(new.id, new.key);
    new.key := coalesce(new.key, new.id);
    return new;
end;
$$;

do $$
begin
    if not exists (
        select 1 from pg_trigger where tgname = 'trg_sync_system_settings_compat'
    ) then
        execute 'create trigger trg_sync_system_settings_compat before insert or update on public.system_settings for each row execute function public.sync_system_settings_compat()';
    end if;
end $$;

-- ============================================================================
-- patients: add compatibility identifiers used by frontend/admin flows
-- ============================================================================
alter table if exists public.patients
    add column if not exists patient_id text,
    add column if not exists personal_id text,
    add column if not exists military_number text;

update public.patients
   set patient_id = coalesce(patient_id, personal_id, military_number, id),
       personal_id = coalesce(personal_id, patient_id, military_number, id),
       military_number = coalesce(military_number, patient_id, personal_id, id)
 where patient_id is null
    or personal_id is null
    or military_number is null;

create index if not exists idx_patients_patient_id on public.patients (patient_id);
create index if not exists idx_patients_personal_id on public.patients (personal_id);
create index if not exists idx_patients_military_number on public.patients (military_number);

create unique index if not exists idx_patients_patient_id_unique on public.patients (patient_id) where patient_id is not null;
create unique index if not exists idx_patients_personal_id_unique on public.patients (personal_id) where personal_id is not null;

create or replace function public.sync_patient_identifier_compat()
returns trigger
language plpgsql
as $$
begin
    new.patient_id := coalesce(new.patient_id, new.personal_id, new.military_number, new.id);
    new.personal_id := coalesce(new.personal_id, new.patient_id, new.military_number, new.id);
    new.military_number := coalesce(new.military_number, new.patient_id, new.personal_id, new.id);
    return new;
end;
$$;

do $$
begin
    if not exists (
        select 1 from pg_trigger where tgname = 'trg_sync_patient_identifier_compat'
    ) then
        execute 'create trigger trg_sync_patient_identifier_compat before insert or update on public.patients for each row execute function public.sync_patient_identifier_compat()';
    end if;
end $$;

-- ============================================================================
-- routes: compatibility table used by admin route screen and dynamic pathways
-- ============================================================================
create table if not exists public.routes (
    id uuid primary key default uuid_generate_v4(),
    exam_type text not null,
    route_name text not null,
    clinics jsonb not null default '[]'::jsonb,
    order_sequence integer not null default 1,
    is_active boolean not null default true,
    description text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

alter table if exists public.routes
    add column if not exists exam_type text,
    add column if not exists route_name text,
    add column if not exists clinics jsonb not null default '[]'::jsonb,
    add column if not exists order_sequence integer not null default 1,
    add column if not exists is_active boolean not null default true,
    add column if not exists description text,
    add column if not exists metadata jsonb not null default '{}'::jsonb,
    add column if not exists updated_at timestamptz default now();

create index if not exists idx_routes_exam_type on public.routes (exam_type);
create index if not exists idx_routes_is_active on public.routes (is_active);
create index if not exists idx_routes_updated_at on public.routes (updated_at desc);
create unique index if not exists idx_routes_id_unique on public.routes (id);

create or replace function public.sync_routes_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

do $$
begin
    if not exists (
        select 1 from pg_trigger where tgname = 'trg_sync_routes_updated_at'
    ) then
        execute 'create trigger trg_sync_routes_updated_at before update on public.routes for each row execute function public.sync_routes_updated_at()';
    end if;
end $$;

alter table if exists public.routes enable row level security;

drop policy if exists "routes_select_public_v2" on public.routes;
drop policy if exists "routes_insert_public_v2" on public.routes;
drop policy if exists "routes_update_public_v2" on public.routes;
drop policy if exists "routes_delete_public_v2" on public.routes;

create policy "routes_select_public_v2"
    on public.routes
    for select
    to public
    using (true);

create policy "routes_insert_public_v2"
    on public.routes
    for insert
    to public
    with check (true);

create policy "routes_update_public_v2"
    on public.routes
    for update
    to public
    using (true)
    with check (true);

create policy "routes_delete_public_v2"
    on public.routes
    for delete
    to public
    using (true);

alter publication supabase_realtime add table if not exists public.routes;
alter publication supabase_realtime add table if not exists public.patients;
alter publication supabase_realtime add table if not exists public.system_settings;
