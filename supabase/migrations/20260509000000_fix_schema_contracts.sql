alter table if exists public.patients add column if not exists military_number text;
alter table if exists public.system_docs add column if not exists path text;
create unique index if not exists idx_patient_routes_patient_exam_type on public.patient_routes (patient_id, exam_type);
create index if not exists idx_patients_military_number on public.patients (military_number);
