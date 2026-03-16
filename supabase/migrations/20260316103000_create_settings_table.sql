-- Canonical settings table for controlled key/value storage only.
-- Scope: operational flags and compatibility keys that are not business entities.

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  namespace text not null,
  key text not null,
  value_text text,
  value_json jsonb,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_namespace_allowed check (namespace in ('admin', 'pins', 'queue', 'events', 'locks', 'cache')),
  constraint settings_value_presence check (value_text is not null or value_json is not null),
  constraint settings_namespace_key_unique unique (namespace, key)
);

create index if not exists idx_settings_namespace_key on public.settings(namespace, key);
create index if not exists idx_settings_updated_at on public.settings(updated_at desc);


alter table public.settings enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'settings' and policyname = 'service_role_manage_settings'
  ) then
    create policy "service_role_manage_settings" on public.settings
      for all to service_role
      using (true)
      with check (true);
  end if;
end
$$;
