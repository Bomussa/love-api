-- The frontend uses local admin sessions, not Supabase Auth sessions.
-- Therefore the notifications admin client must be writable from the public role
-- while remaining constrained by the application's own admin UI.

drop policy if exists "notifications_update_authenticated" on public.notifications;
drop policy if exists "notifications_delete_authenticated" on public.notifications;
drop policy if exists "notifications_update_public" on public.notifications;
drop policy if exists "notifications_delete_public" on public.notifications;

drop policy if exists "notifications update public" on public.notifications;
drop policy if exists "notifications delete public" on public.notifications;

create policy "notifications_update_public"
  on public.notifications
  for update
  to public
  using (true)
  with check (true);

create policy "notifications_delete_public"
  on public.notifications
  for delete
  to public
  using (true);
