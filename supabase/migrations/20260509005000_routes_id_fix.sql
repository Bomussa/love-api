do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'routes'
  ) then
    begin
      execute 'create extension if not exists "uuid-ossp"';
    exception when others then null;
    end;

    alter table if exists public.routes
      add column if not exists id uuid;

    update public.routes
      set id = coalesce(id, uuid_generate_v4())
      where id is null;

    alter table if exists public.routes
      alter column id set default uuid_generate_v4();

    create unique index if not exists idx_routes_id on public.routes (id);
  end if;
end $$;
