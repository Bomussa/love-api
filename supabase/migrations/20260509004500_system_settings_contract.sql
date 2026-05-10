alter table if exists public.system_settings
    add column if not exists description text;

create index if not exists idx_system_settings_key on public.system_settings (key);

alter table if exists public.system_settings enable row level security;

drop policy if exists "system_settings_select_public_v2" on public.system_settings;
drop policy if exists "system_settings_insert_public_v2" on public.system_settings;
drop policy if exists "system_settings_update_public_v2" on public.system_settings;
drop policy if exists "system_settings_delete_public_v2" on public.system_settings;

create policy "system_settings_select_public_v2"
    on public.system_settings
    for select
    to public
    using (true);

create policy "system_settings_insert_public_v2"
    on public.system_settings
    for insert
    to public
    with check (true);

create policy "system_settings_update_public_v2"
    on public.system_settings
    for update
    to public
    using (true)
    with check (true);

create policy "system_settings_delete_public_v2"
    on public.system_settings
    for delete
    to public
    using (true);
