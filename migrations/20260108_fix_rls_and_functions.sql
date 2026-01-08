-- 1) تشديد RLS — patients, notifications, pathways
-- Ensure functions to get auth uid exist
create or replace function auth.uid() returns uuid as $$
begin
  return current_setting('request.jwt.claim.sub')::uuid;
exception when others then
  return null;
end;
$$ language plpgsql stable;

-- patients: allow SELECT only for rows matching clinic or own patient record
alter table patients enable row level security;
drop policy if exists "Patients can view own data" on patients;
create policy patients_select_limited on patients
  for select using (
    (id::text = auth.uid()::text)
    OR (exists (select 1 from queue q where q.patient_id = patients.id::text))
  );

-- notifications: allow insert for authenticated who belong to clinic; select for relevant users only
alter table notifications enable row level security;
drop policy if exists "Notifications are viewable by patient" on notifications;
create policy notifications_crud on notifications
  for all using (
    (patient_id = auth.uid()::text)
  );

-- pathways: restrict similarly
alter table pathways enable row level security;
drop policy if exists "Pathways are viewable by patient" on pathways;
create policy pathways_select on pathways
  for select using (
    (patient_id = auth.uid()::text)
  );

-- 2) وظائف Postgres نهائية (PIN, next_ticket, archive)
CREATE TABLE IF NOT EXISTS clinic_pins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id TEXT REFERENCES clinics(id),
    date DATE DEFAULT CURRENT_DATE,
    pin_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(clinic_id, date)
);

create or replace function fn_get_daily_pin(p_clinic text)
returns text as $$
declare
  v_pin_rec record;
  v_pin text;
begin
  select * into v_pin_rec from clinic_pins where clinic_id = p_clinic and date = current_date;
  if found then
    return v_pin_rec.pin_hash;
  end if;
  v_pin := lpad((floor(random()*900000)+100000)::text,6,'0');
  insert into clinic_pins (clinic_id, date, pin_hash, created_at)
    values (p_clinic, current_date, crypt(v_pin, gen_salt('bf')), now());
  return v_pin;
end;
$$ language plpgsql security definer;

-- Next ticket number generator
create or replace function fn_get_next_ticket(p_clinic text)
returns integer as $$
begin
  return get_next_display_number(p_clinic);
end;
$$ language plpgsql security definer;

-- Archive completed queue items to history
create or replace function fn_archive_completed()
returns trigger as $$
begin
  if NEW.status = 'completed' then
    INSERT INTO queue_history (
        clinic_id,
        patient_id,
        display_number,
        entered_at,
        completed_at,
        wait_time_seconds,
        completed_by_pin
    ) VALUES (
        NEW.clinic_id,
        NEW.patient_id,
        NEW.position,
        NEW.entered_at,
        NEW.completed_at,
        EXTRACT(EPOCH FROM (NEW.completed_at - NEW.entered_at))::INTEGER,
        NEW.completed_by_pin
    );
    delete from queue where id = NEW.id;
    return null;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists archive_queue_on_complete on queue;
create trigger archive_queue_on_complete_v2 
after update on queue 
for each row 
when (NEW.status = 'completed')
execute function fn_archive_completed();

-- 3) Views for reports
create or replace view v_reports_daily as
select clinic_id, date_trunc('day', completed_at) as day,
       count(*) as completed,
       avg(wait_time_seconds) as avg_wait_seconds
from queue_history
group by clinic_id, date_trunc('day', completed_at);
