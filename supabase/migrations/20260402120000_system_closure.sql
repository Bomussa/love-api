BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  current_load INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id TEXT NOT NULL,
  queue_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  current_step INTEGER DEFAULT 0,
  path JSONB NOT NULL,
  version INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  response JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE queues ADD COLUMN IF NOT EXISTS called_at TIMESTAMP;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

ALTER TABLE queues DROP CONSTRAINT IF EXISTS unique_queue_per_clinic;
ALTER TABLE queues
ADD CONSTRAINT unique_queue_per_clinic
UNIQUE (clinic_id, queue_number);

ALTER TABLE queues DROP CONSTRAINT IF EXISTS status_check;
ALTER TABLE queues
ADD CONSTRAINT status_check
CHECK (status IN ('WAITING','CALLED','IN_PROGRESS','DONE','CANCELLED'));

ALTER TABLE queues DROP CONSTRAINT IF EXISTS step_bounds;
ALTER TABLE queues
ADD CONSTRAINT step_bounds
CHECK (current_step >= 0);

CREATE OR REPLACE FUNCTION fn_create_queue_atomic(
  p_patient_id TEXT,
  p_exam_type TEXT,
  p_path JSONB
)
RETURNS TABLE(queue_id UUID, number INTEGER, version INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_first_clinic TEXT;
  v_max INTEGER;
  v_queue_id UUID;
  v_try INTEGER := 0;
BEGIN
  IF p_path IS NULL OR jsonb_typeof(p_path) <> 'array' OR jsonb_array_length(p_path) = 0 THEN
    RAISE EXCEPTION 'invalid_path';
  END IF;

  v_first_clinic := p_path ->> 0;

  <<retry_insert>>
  LOOP
    BEGIN
      PERFORM 1 FROM clinics WHERE id::text = v_first_clinic FOR UPDATE;

      SELECT COALESCE(MAX(queue_number), 0)
      INTO v_max
      FROM queues
      WHERE clinic_id = v_first_clinic
      FOR UPDATE;

      INSERT INTO queues (
        clinic_id,
        queue_number,
        status,
        current_step,
        path,
        version,
        created_at,
        updated_at
      ) VALUES (
        v_first_clinic,
        v_max + 1,
        'WAITING',
        0,
        p_path,
        0,
        NOW(),
        NOW()
      ) RETURNING id INTO v_queue_id;

      UPDATE clinics
      SET current_load = current_load + 1
      WHERE id::text = v_first_clinic;

      RETURN QUERY SELECT v_queue_id, v_max + 1, 0;
      EXIT retry_insert;
    EXCEPTION
      WHEN unique_violation THEN
        IF v_try >= 1 THEN RAISE; END IF;
        v_try := v_try + 1;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION fn_call_queue_atomic(
  p_clinic_id TEXT
)
RETURNS TABLE(queue_id UUID, number INTEGER, status TEXT, called_at TIMESTAMP, version INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_q queues%ROWTYPE;
BEGIN
  SELECT * INTO v_q
  FROM queues
  WHERE clinic_id = p_clinic_id AND status = 'WAITING'
  ORDER BY queue_number ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE queues
  SET status = 'CALLED',
      called_at = NOW(),
      version = v_q.version + 1,
      updated_at = NOW()
  WHERE id = v_q.id;

  RETURN QUERY
  SELECT id, queue_number, status, called_at, version
  FROM queues
  WHERE id = v_q.id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_start_queue_atomic(
  p_queue_id UUID,
  p_doctor_clinic_id TEXT,
  p_expected_version INTEGER
)
RETURNS TABLE(queue_id UUID, status TEXT, current_step INTEGER, version INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_q queues%ROWTYPE;
  v_expected_clinic TEXT;
BEGIN
  SELECT * INTO v_q FROM queues WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_not_found'; END IF;
  IF v_q.version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF;
  IF v_q.status NOT IN ('WAITING','CALLED') THEN RAISE EXCEPTION 'invalid_state'; END IF;

  v_expected_clinic := v_q.path ->> v_q.current_step;
  IF p_doctor_clinic_id <> v_expected_clinic THEN RAISE EXCEPTION 'forbidden_clinic'; END IF;

  UPDATE queues
  SET status = 'IN_PROGRESS',
      current_step = 1,
      activated_at = NOW(),
      version = v_q.version + 1,
      updated_at = NOW()
  WHERE id = p_queue_id;

  RETURN QUERY SELECT id, status, current_step, version FROM queues WHERE id = p_queue_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_advance_queue_atomic(
  p_queue_id UUID,
  p_doctor_clinic_id TEXT,
  p_expected_version INTEGER
)
RETURNS TABLE(queue_id UUID, status TEXT, current_step INTEGER, version INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_q queues%ROWTYPE;
  v_len INTEGER;
  v_expected_clinic TEXT;
  v_next_step INTEGER;
  v_next_status TEXT;
BEGIN
  SELECT * INTO v_q FROM queues WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_not_found'; END IF;
  IF v_q.version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF;
  IF v_q.status <> 'IN_PROGRESS' THEN RAISE EXCEPTION 'invalid_state'; END IF;

  v_len := jsonb_array_length(v_q.path);
  IF v_q.current_step > v_len THEN RAISE EXCEPTION 'step_overflow'; END IF;

  v_expected_clinic := v_q.path ->> (v_q.current_step - 1);
  IF p_doctor_clinic_id <> v_expected_clinic THEN RAISE EXCEPTION 'forbidden_clinic'; END IF;

  v_next_step := v_q.current_step + 1;
  v_next_status := CASE WHEN v_next_step > v_len THEN 'DONE' ELSE 'WAITING' END;

  UPDATE queues
  SET current_step = v_next_step,
      status = v_next_status,
      version = v_q.version + 1,
      updated_at = NOW()
  WHERE id = p_queue_id;

  IF v_next_status = 'DONE' THEN
    UPDATE clinics SET current_load = GREATEST(0, current_load - 1) WHERE id::text = v_q.clinic_id;
  END IF;

  RETURN QUERY SELECT id, status, current_step, version FROM queues WHERE id = p_queue_id;
END;
$$;

COMMIT;
