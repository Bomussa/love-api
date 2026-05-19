-- Harden ACL/RLS for public.doctors
-- Goal:
-- 1) Remove any anon write capability.
-- 2) Keep role-based access explicit for service_role/authenticated.
-- 3) Keep object grants minimal (principle of least privilege).

begin;

-- Ensure RLS is active and enforced for all non-bypass roles.
alter table public.doctors enable row level security;
alter table public.doctors force row level security;

-- Reset grants first.
revoke all on table public.doctors from anon;
revoke all on table public.doctors from authenticated;
revoke all on table public.doctors from service_role;

-- service_role is the backend trusted actor.
grant select, insert, update, delete on table public.doctors to service_role;

-- authenticated users are read-only and can see only their own doctor profile.
grant select on table public.doctors to authenticated;

-- Remove legacy/unknown policies to avoid accidental overlap.
drop policy if exists doctors_service_role_all on public.doctors;
drop policy if exists doctors_authenticated_select_self on public.doctors;
drop policy if exists "Allow anon read" on public.doctors;
drop policy if exists "Allow public read" on public.doctors;
drop policy if exists "Enable read access for all users" on public.doctors;

-- Explicit policy: service_role full access.
create policy doctors_service_role_all
on public.doctors
for all
to service_role
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- Explicit policy: authenticated can read only their own row.
create policy doctors_authenticated_select_self
on public.doctors
for select
to authenticated
using (id = auth.uid());

commit;

-- Safe rollback (temporary emergency use only):
-- begin;
--   drop policy if exists doctors_service_role_all on public.doctors;
--   drop policy if exists doctors_authenticated_select_self on public.doctors;
--   alter table public.doctors no force row level security;
--   revoke all on table public.doctors from anon;
--   revoke all on table public.doctors from authenticated;
--   revoke all on table public.doctors from service_role;
--   grant select on table public.doctors to anon; -- only if legacy frontend proves this dependency
--   grant select, insert, update, delete on table public.doctors to service_role;
-- commit;
