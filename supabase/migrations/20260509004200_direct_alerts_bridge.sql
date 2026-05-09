create extension if not exists "uuid-ossp";

create table if not exists public.direct_alerts (
    id uuid primary key default uuid_generate_v4(),
    source_notification_id uuid unique references public.notifications(id) on delete cascade,
    patient_id text not null,
    alert_type text not null default 'info',
    message text not null,
    message_en text,
    sound_enabled boolean default false,
    is_active boolean default true,
    expires_at timestamptz not null default (now() + interval '24 hours'),
    read_at timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

alter table if exists public.direct_alerts
    add column if not exists source_notification_id uuid,
    add column if not exists message_en text,
    add column if not exists sound_enabled boolean default false,
    add column if not exists is_active boolean default true,
    add column if not exists expires_at timestamptz not null default (now() + interval '24 hours'),
    add column if not exists read_at timestamptz,
    add column if not exists updated_at timestamptz default now();

create index if not exists idx_direct_alerts_patient_active on public.direct_alerts (patient_id, is_active, expires_at desc);
create index if not exists idx_direct_alerts_source_notification on public.direct_alerts (source_notification_id);

alter table if exists public.direct_alerts enable row level security;

drop policy if exists "direct_alerts_select_public_v2" on public.direct_alerts;
drop policy if exists "direct_alerts_insert_public_v2" on public.direct_alerts;
drop policy if exists "direct_alerts_update_public_v2" on public.direct_alerts;
drop policy if exists "direct_alerts_delete_public_v2" on public.direct_alerts;

create policy "direct_alerts_select_public_v2"
    on public.direct_alerts
    for select
    to public
    using (true);

create policy "direct_alerts_insert_public_v2"
    on public.direct_alerts
    for insert
    to public
    with check (true);

create policy "direct_alerts_update_public_v2"
    on public.direct_alerts
    for update
    to public
    using (true)
    with check (true);

create policy "direct_alerts_delete_public_v2"
    on public.direct_alerts
    for delete
    to public
    using (true);

create or replace function public.sync_notification_to_direct_alert()
returns trigger
language plpgsql
as $$
declare
    v_alert_type text;
    v_sound boolean;
    v_expires timestamptz;
    v_patient_id text;
begin
    if TG_OP = 'DELETE' then
        delete from public.direct_alerts where source_notification_id = OLD.id;
        return OLD;
    end if;

    v_patient_id := coalesce(new.target_patient_id, new.patient_id);

    if coalesce(v_patient_id, '') = '' then
        delete from public.direct_alerts where source_notification_id = NEW.id;
        return NEW;
    end if;

    v_alert_type := case
        when coalesce(new.priority, 'normal') = 'urgent' or new.type = 'call' then 'urgent'
        when coalesce(new.priority, 'normal') = 'high' or new.type = 'alert' then 'warning'
        when new.type = 'update' then 'success'
        else 'info'
    end;

    v_sound := case
        when coalesce(new.priority, 'normal') in ('high', 'urgent') or new.type = 'call' then true
        else false
    end;

    v_expires := coalesce(new.scheduled_at, new.sent_at, new.created_at, now()) + interval '24 hours';

    insert into public.direct_alerts (
        source_notification_id,
        patient_id,
        alert_type,
        message,
        message_en,
        sound_enabled,
        is_active,
        expires_at,
        created_at,
        updated_at
    ) values (
        new.id,
        v_patient_id,
        v_alert_type,
        new.message,
        new.message,
        v_sound,
        coalesce(new.is_active, true) and not coalesce(new.is_hidden, false),
        v_expires,
        coalesce(new.created_at, now()),
        now()
    )
    on conflict (source_notification_id) do update set
        patient_id = excluded.patient_id,
        alert_type = excluded.alert_type,
        message = excluded.message,
        message_en = excluded.message_en,
        sound_enabled = excluded.sound_enabled,
        is_active = excluded.is_active,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at;

    return NEW;
end;
$$;

do $$
begin
    if not exists (
        select 1 from pg_trigger where tgname = 'trg_sync_notification_to_direct_alert'
    ) then
        execute 'create trigger trg_sync_notification_to_direct_alert after insert or update or delete on public.notifications for each row execute function public.sync_notification_to_direct_alert()';
    end if;
end $$;

insert into public.direct_alerts (
    source_notification_id,
    patient_id,
    alert_type,
    message,
    message_en,
    sound_enabled,
    is_active,
    expires_at,
    created_at,
    updated_at
)
select
    n.id,
    coalesce(n.target_patient_id, n.patient_id),
    case
        when coalesce(n.priority, 'normal') = 'urgent' or n.type = 'call' then 'urgent'
        when coalesce(n.priority, 'normal') = 'high' or n.type = 'alert' then 'warning'
        when n.type = 'update' then 'success'
        else 'info'
    end,
    n.message,
    n.message,
    case when coalesce(n.priority, 'normal') in ('high', 'urgent') or n.type = 'call' then true else false end,
    coalesce(n.is_active, true) and not coalesce(n.is_hidden, false),
    coalesce(n.scheduled_at, n.sent_at, n.created_at, now()) + interval '24 hours',
    coalesce(n.created_at, now()),
    now()
from public.notifications n
where coalesce(n.patient_id, '') <> ''
  and not exists (
      select 1 from public.direct_alerts d where d.source_notification_id = n.id
  )
on conflict (source_notification_id) do nothing;

alter publication supabase_realtime add table if not exists public.direct_alerts;
