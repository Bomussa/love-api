-- Align notifications table with the admin UI used in the frontend.
-- This migration is intentionally additive and preserves legacy columns.

-- 1) The current admin UI stores a military/personal identifier as text.
-- Convert the legacy bigint FK column to text and remove any FK constraints.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'notifications'
      and c.contype = 'f'
  loop
    execute format('alter table public.notifications drop constraint if exists %I', r.conname);
  end loop;
end$$;

alter table if exists public.notifications
  alter column patient_id type text using patient_id::text;

-- 2) Add the fields used by both notification managers.
alter table if exists public.notifications
  add column if not exists title text,
  add column if not exists target_patient_id text,
  add column if not exists clinic_id uuid,
  add column if not exists status text default 'draft',
  add column if not exists is_hidden boolean default false,
  add column if not exists priority text default 'normal',
  add column if not exists scheduled_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists duration_seconds integer default 10,
  add column if not exists position text default 'top-center',
  add column if not exists font_family text default 'default',
  add column if not exists font_size integer default 16,
  add column if not exists text_color text default '#FFFFFF',
  add column if not exists background_type text default 'gradient',
  add column if not exists background_value text default 'linear-gradient(135deg, #8A1538 0%, #C9A54C 100%)',
  add column if not exists border_radius integer default 12,
  add column if not exists animation text default 'slide-down',
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists is_read boolean default false,
  add column if not exists sent_at timestamptz,
  add column if not exists updated_at timestamptz default now();

-- 3) Keep the older "read" column available for legacy screens.
-- No destructive migration is applied here.

-- 4) Allow authenticated admin sessions to edit and delete notifications.
drop policy if exists "notifications_update_authenticated" on public.notifications;
drop policy if exists "notifications_delete_authenticated" on public.notifications;
drop policy if exists "notifications_update_admin" on public.notifications;
drop policy if exists "notifications_delete_admin" on public.notifications;

drop policy if exists "notifications update authenticated" on public.notifications;
drop policy if exists "notifications delete authenticated" on public.notifications;

action policy "notifications_update_authenticated" on public.notifications
  for update
  to authenticated
  using (true)
  with check (true);

create policy "notifications_delete_authenticated"
  on public.notifications
  for delete
  to authenticated
  using (true);

-- 5) Keep realtime enabled for the table.
alter publication supabase_realtime add table if not exists public.notifications;
