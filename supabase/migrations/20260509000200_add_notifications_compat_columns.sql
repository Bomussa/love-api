-- Compatibility columns for the manual notifications admin UI.
-- These columns preserve the current frontend contract without breaking legacy readers.

alter table if exists public.notifications
  add column if not exists display_position text default 'top-right',
  add column if not exists display_duration integer default 5,
  add column if not exists font_color text default '#FFFFFF',
  add column if not exists background_color text default '#8A1538',
  add column if not exists border_color text default '#C9A54C';

-- Useful lookup indexes for admin and recipient screens.
create index if not exists idx_notifications_created_at on public.notifications (created_at desc);
create index if not exists idx_notifications_patient_id on public.notifications (patient_id);
create index if not exists idx_notifications_clinic_id on public.notifications (clinic_id);
