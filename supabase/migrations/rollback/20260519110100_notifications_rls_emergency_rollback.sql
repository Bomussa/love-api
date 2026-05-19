-- EMERGENCY ROLLBACK ONLY
-- Reverts notifications RLS hardening to previously permissive behavior.
--
-- SECURITY RISK:
-- - Restores public read/insert and broad service_role update/delete behavior.
-- - May allow unauthorized notification creation/read if app-layer checks fail.
-- - Use only during incident mitigation, then re-apply hardening migration ASAP.

alter table public.notifications enable row level security;

-- Remove hardened policies.
drop policy if exists "notifications_select_owner_authenticated" on public.notifications;
drop policy if exists "notifications_insert_service_role" on public.notifications;
drop policy if exists "notifications_update_service_role" on public.notifications;
drop policy if exists "notifications_delete_service_role" on public.notifications;

-- Restore legacy permissive policies.
create policy "Enable read access for all users"
  on public.notifications
  for select
  using (true);

create policy "Enable insert access for all users"
  on public.notifications
  for insert
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

-- Optional: disable FORCE RLS to match permissive historical behavior.
alter table public.notifications no force row level security;
