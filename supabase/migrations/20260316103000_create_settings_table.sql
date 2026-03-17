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

-- Migration path for environments that already have a legacy settings table.
alter table public.settings
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists namespace text,
  add column if not exists key text,
  add column if not exists value_text text,
  add column if not exists value_json jsonb,
  add column if not exists description text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- Backfill new columns from legacy shape.
update public.settings
set
  key = coalesce(key, to_jsonb(public.settings)->>'name'),
  value_text = coalesce(value_text, to_jsonb(public.settings)->>'value'),
  namespace = coalesce(
    namespace,
    nullif(split_part(coalesce(key, to_jsonb(public.settings)->>'name'), ':', 1), ''),
    'cache'
  ),
  updated_at = coalesce(updated_at, created_at, now()),
  created_at = coalesce(created_at, now())
where
  key is null
  or value_text is null
  or namespace is null
  or created_at is null
  or updated_at is null;

delete from public.settings where key is null;

alter table public.settings
  alter column id set default gen_random_uuid(),
  alter column namespace set not null,
  alter column key set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'settings_pkey'
      and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings add constraint settings_pkey primary key (id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'settings_namespace_allowed'
      and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings
      add constraint settings_namespace_allowed
      check (namespace in ('admin', 'pins', 'queue', 'events', 'locks', 'cache'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'settings_value_presence'
      and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings
      add constraint settings_value_presence
      check (value_text is not null or value_json is not null);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'settings_namespace_key_unique'
      and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings
      add constraint settings_namespace_key_unique unique (namespace, key);
  end if;
end
$$;

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
