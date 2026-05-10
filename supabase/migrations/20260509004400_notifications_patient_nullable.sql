alter table if exists public.notifications
    alter column patient_id drop not null;
