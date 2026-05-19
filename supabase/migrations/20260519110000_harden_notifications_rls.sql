-- Harden RLS policies for public.notifications.
-- This migration removes any broad public write access and keeps writes restricted.

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

-- Remove legacy/open policies first (including legacy spaced names).
drop policy if exists "notifications_update_public" on public.notifications;
drop policy if exists "notifications_delete_public" on public.notifications;
drop policy if exists "notifications_insert_public" on public.notifications;
drop policy if exists "notifications update public" on public.notifications;
drop policy if exists "notifications delete public" on public.notifications;
drop policy if exists "notifications insert public" on public.notifications;

drop policy if exists "Enable read access for all users" on public.notifications;
drop policy if exists "Enable insert access for all users" on public.notifications;

-- Drop old variants to avoid duplicates/conflicts.
drop policy if exists "notifications_select_authenticated" on public.notifications;
drop policy if exists "notifications_select_owner_authenticated" on public.notifications;
drop policy if exists "notifications_select_public" on public.notifications;
drop policy if exists "notifications_update_authenticated" on public.notifications;
drop policy if exists "notifications_delete_authenticated" on public.notifications;
drop policy if exists "notifications_update_service_role" on public.notifications;
drop policy if exists "notifications_delete_service_role" on public.notifications;
drop policy if exists "notifications_insert_service_role" on public.notifications;

-- Restricted read: authenticated users can read only their own notifications.
create policy "notifications_select_owner_authenticated"
  on public.notifications
  for select
  to authenticated
  using (auth.uid() = patient_id);

-- Restricted write: service_role only.
create policy "notifications_insert_service_role"
  on public.notifications
  for insert
  to service_role
  with check (true);

create policy "notifications_update_service_role"
  on public.notifications
  for update
  to service_role
  using (true)
  with check (true);

create policy "notifications_delete_service_role"
  on public.notifications
  for delete
  to service_role
  using (true);

-- Assert-style safety checks: forbid open USING(true)/WITH CHECK(true) policies for write operations.
do $$
declare
  v_open_write_count integer;
begin
  select count(*)
    into v_open_write_count
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'notifications'
    and p.cmd in ('INSERT', 'UPDATE', 'DELETE')
    and (
      coalesce(p.qual, '') = 'true'
      or coalesce(p.with_check, '') = 'true'
    )
    and (
      p.roles @> array['public']::name[]
      or p.roles @> array['authenticated']::name[]
    );

  if v_open_write_count > 0 then
    raise exception 'Unsafe open write policies still exist on public.notifications (% rows)', v_open_write_count;
  end if;
end
$$;
