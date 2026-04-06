-- MMC System Closure v7.0 Migration
-- ============================================
-- 1. Remove PIN System Tables
DROP TABLE IF EXISTS pins CASCADE;
DROP TABLE IF EXISTS clinic_pins CASCADE;

-- 2. Unified Queue Schema (Canonical Schema)
-- Ensure queues table has all necessary columns
ALTER TABLE queues ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ;
ALTER TABLE queues ADD COLUMN IF NOT EXISTS entered_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Idempotency Keys Table
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    response_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Atomic Queue RPCs
CREATE OR REPLACE FUNCTION create_queue_atomic(
    p_patient_id TEXT,
    p_exam_type TEXT,
    p_clinic_id TEXT,
    p_path TEXT[],
    p_queue_date DATE
) RETURNS JSONB AS $$
DECLARE
    v_number INTEGER;
    v_result JSONB;
BEGIN
    -- Lock for the specific clinic and date to prevent race conditions
    PERFORM * FROM queues 
    WHERE clinic_id = p_clinic_id AND queue_date = p_queue_date 
    FOR UPDATE;

    -- Get next number
    SELECT COALESCE(MAX(display_number), 0) + 1 INTO v_number
    FROM queues
    WHERE clinic_id = p_clinic_id AND queue_date = p_queue_date;

    -- Insert new queue entry
    INSERT INTO queues (
        patient_id, clinic_id, exam_type, display_number, 
        queue_number, path, current_step, status, version, 
        queue_date, entered_at
    ) VALUES (
        p_patient_id, p_clinic_id, p_exam_type, v_number,
        v_number::TEXT, p_path, 0, 'WAITING', 1,
        p_queue_date, NOW()
    ) RETURNING to_jsonb(queues.*) INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- 5. Recovery RPC
CREATE OR REPLACE FUNCTION recover_in_progress_queues() RETURNS VOID AS $$
BEGIN
    -- Reset any stuck IN_PROGRESS queues to WAITING if they were from a previous session
    -- (Simplified logic for the migration)
    UPDATE queues 
    SET status = 'WAITING' 
    WHERE status = 'IN_PROGRESS' 
    AND updated_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;
