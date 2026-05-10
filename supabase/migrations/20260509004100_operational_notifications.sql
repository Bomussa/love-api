create extension if not exists "uuid-ossp";

create table if not exists public.operational_notifications (
    id uuid primary key default uuid_generate_v4(),
    notification_type text not null,
    title_ar text not null,
    title_en text not null,
    message_ar text not null,
    message_en text not null,
    priority text not null default 'normal',
    sound_enabled boolean default true,
    vibrate_enabled boolean default false,
    is_active boolean default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_operational_notifications_type on public.operational_notifications (notification_type);
create index if not exists idx_operational_notifications_active on public.operational_notifications (is_active);

alter table if exists public.operational_notifications enable row level security;

drop policy if exists "operational_notifications_select_public_v2" on public.operational_notifications;
drop policy if exists "operational_notifications_insert_public_v2" on public.operational_notifications;
drop policy if exists "operational_notifications_update_public_v2" on public.operational_notifications;
drop policy if exists "operational_notifications_delete_public_v2" on public.operational_notifications;

create policy "operational_notifications_select_public_v2" on public.operational_notifications for select to public using (true);
create policy "operational_notifications_insert_public_v2" on public.operational_notifications for insert to public with check (true);
create policy "operational_notifications_update_public_v2" on public.operational_notifications for update to public using (true) with check (true);
create policy "operational_notifications_delete_public_v2" on public.operational_notifications for delete to public using (true);
