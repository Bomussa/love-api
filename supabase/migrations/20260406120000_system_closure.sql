-- ============================================================================
-- SYSTEM CLOSURE MIGRATION
-- Date: 2026-04-06
-- Version: 5.0.0
-- Description: Complete system schema with NO PIN system
-- ============================================================================

-- ============================================================================
-- 1. DROP LEGACY TABLES (PIN system removal)
-- ============================================================================
DROP TABLE IF EXISTS pins CASCADE;
DROP TABLE IF EXISTS pin_codes CASCADE;
DROP TABLE IF EXISTS daily_pins CASCADE;
DROP TABLE IF EXISTS unified_queue CASCADE;
DROP TABLE IF EXISTS queue CASCADE;

-- ============================================================================
-- 2. CORE TABLES
-- ============================================================================

-- Clinics table
CREATE TABLE IF NOT EXISTS clinics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_ar TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Patients table
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    personal_id TEXT UNIQUE NOT NULL,
    name TEXT,
    gender TEXT CHECK (gender IN ('male', 'female')),
    date_of_birth DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Doctors table
CREATE TABLE IF NOT EXISTS doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    clinic_id TEXT REFERENCES clinics(id),
    clinic_name TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 3. QUEUE SYSTEM (Atomic, No PIN)
-- ============================================================================

CREATE TABLE IF NOT EXISTS queues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id TEXT NOT NULL,
    clinic_id TEXT NOT NULL REFERENCES clinics(id),
    queue_number INTEGER NOT NULL,
    queue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'WAITING' 
        CHECK (status IN ('WAITING', 'CALLED', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
    exam_type TEXT DEFAULT 'comprehensive',
    gender TEXT CHECK (gender IN ('male', 'female')),
    current_step INTEGER DEFAULT 0 CHECK (current_step >= 0),
    pathway TEXT[] DEFAULT '{}',
    version INTEGER DEFAULT 1,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    called_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- References
    called_by UUID REFERENCES doctors(id),
    started_by UUID REFERENCES doctors(id),
    previous_queue_id UUID REFERENCES queues(id),
    next_queue_id UUID REFERENCES queues(id),
    
    -- CRITICAL: Unique constraint to prevent duplicate queue numbers per clinic per day
    UNIQUE(clinic_id, queue_date, queue_number)
);

-- ============================================================================
-- 4. IDEMPOTENCY SYSTEM
-- ============================================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    request_hash TEXT,
    response JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Auto-cleanup expired keys
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

-- ============================================================================
-- 5. ACTIVITY LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    user_id TEXT,
    user_type TEXT,
    clinic_id TEXT,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_clinic ON activity_logs(clinic_id);

-- ============================================================================
-- 6. INDEXES FOR PERFORMANCE
-- ============================================================================

-- Queue indexes
CREATE INDEX IF NOT EXISTS idx_queues_patient ON queues(patient_id);
CREATE INDEX IF NOT EXISTS idx_queues_clinic_date ON queues(clinic_id, queue_date);
CREATE INDEX IF NOT EXISTS idx_queues_status ON queues(status);
CREATE INDEX IF NOT EXISTS idx_queues_clinic_status ON queues(clinic_id, queue_date, status);
CREATE INDEX IF NOT EXISTS idx_queues_waiting ON queues(clinic_id, queue_date, status, queue_number) 
    WHERE status = 'WAITING';

-- ============================================================================
-- 7. RPC FUNCTIONS
-- ============================================================================

-- Atomic queue number generation
CREATE OR REPLACE FUNCTION increment_clinic_counter(p_clinic_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    next_number INTEGER;
BEGIN
    -- Use advisory lock for atomicity
    PERFORM pg_advisory_xact_lock(hashtext('clinic_counter:' || p_clinic_id));
    
    SELECT COALESCE(MAX(queue_number), 0) + 1
    INTO next_number
    FROM queues
    WHERE clinic_id = p_clinic_id
    AND queue_date = CURRENT_DATE;
    
    RETURN next_number;
END;
$$;

-- Get next waiting patient (atomic)
CREATE OR REPLACE FUNCTION get_next_waiting(p_clinic_id TEXT)
RETURNS TABLE (
    id UUID,
    patient_id TEXT,
    queue_number INTEGER,
    status TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT q.id, q.patient_id, q.queue_number, q.status
    FROM queues q
    WHERE q.clinic_id = p_clinic_id
    AND q.queue_date = CURRENT_DATE
    AND q.status = 'WAITING'
    ORDER BY q.queue_number ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
END;
$$;

-- Update queue status with version check (optimistic locking)
CREATE OR REPLACE FUNCTION update_queue_status(
    p_queue_id UUID,
    p_new_status TEXT,
    p_expected_version INTEGER,
    p_doctor_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    updated BOOLEAN := false;
BEGIN
    UPDATE queues
    SET 
        status = p_new_status,
        version = version + 1,
        called_by = CASE WHEN p_new_status = 'CALLED' THEN p_doctor_id ELSE called_by END,
        started_by = CASE WHEN p_new_status = 'IN_PROGRESS' THEN p_doctor_id ELSE started_by END,
        called_at = CASE WHEN p_new_status = 'CALLED' THEN NOW() ELSE called_at END,
        started_at = CASE WHEN p_new_status = 'IN_PROGRESS' THEN NOW() ELSE started_at END,
        completed_at = CASE WHEN p_new_status = 'DONE' THEN NOW() ELSE completed_at END
    WHERE id = p_queue_id
    AND version = p_expected_version;
    
    GET DIAGNOSTICS updated = ROW_COUNT;
    RETURN updated > 0;
END;
$$;

-- Get queue stats for clinic
CREATE OR REPLACE FUNCTION get_clinic_stats(p_clinic_id TEXT)
RETURNS TABLE (
    waiting BIGINT,
    called BIGINT,
    in_progress BIGINT,
    done BIGINT,
    total BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) FILTER (WHERE status = 'WAITING') as waiting,
        COUNT(*) FILTER (WHERE status = 'CALLED') as called,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') as in_progress,
        COUNT(*) FILTER (WHERE status = 'DONE') as done,
        COUNT(*) as total
    FROM queues
    WHERE clinic_id = p_clinic_id
    AND queue_date = CURRENT_DATE;
END;
$$;

-- Recover queues after restart (reset IN_PROGRESS to WAITING)
CREATE OR REPLACE FUNCTION recover_queues_after_restart()
RETURNS TABLE (recovered_count INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
    count INTEGER := 0;
BEGIN
    UPDATE queues
    SET 
        status = 'WAITING',
        version = version + 1
    WHERE queue_date = CURRENT_DATE
    AND status = 'IN_PROGRESS';
    
    GET DIAGNOSTICS count = ROW_COUNT;
    
    RETURN QUERY SELECT count;
END;
$$;

-- Log activity
CREATE OR REPLACE FUNCTION log_activity(
    p_action TEXT,
    p_user_id TEXT DEFAULT NULL,
    p_user_type TEXT DEFAULT NULL,
    p_clinic_id TEXT DEFAULT NULL,
    p_details JSONB DEFAULT NULL,
    p_ip_address TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    log_id UUID;
BEGIN
    INSERT INTO activity_logs (action, user_id, user_type, clinic_id, details, ip_address)
    VALUES (p_action, p_user_id, p_user_type, p_clinic_id, p_details, p_ip_address)
    RETURNING id INTO log_id;
    
    RETURN log_id;
END;
$$;

-- ============================================================================
-- 8. TRIGGERS
-- ============================================================================

-- Auto-increment version on update
CREATE OR REPLACE FUNCTION increment_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_increment_version ON queues;
CREATE TRIGGER trigger_increment_version
    BEFORE UPDATE ON queues
    FOR EACH ROW
    EXECUTE FUNCTION increment_version();

-- Clean expired idempotency keys (runs periodically)
CREATE OR REPLACE FUNCTION clean_expired_idempotency_keys()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM idempotency_keys
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- ============================================================================
-- 9. SEED DATA
-- ============================================================================

-- Insert clinics
INSERT INTO clinics (id, name, name_ar, display_order) VALUES
('registration', 'Registration', 'التسجيل', 1),
('vitals', 'Vitals', 'القياسات الحيوية', 2),
('lab', 'Laboratory', 'المختبر', 3),
('xray', 'X-Ray', 'الأشعة', 4),
('ecg', 'ECG', 'تخطيط القلب', 5),
('audio', 'Audiometry', 'سمعيات', 6),
('eyes', 'Eye Examination', 'فحص العيون', 7),
('internal', 'Internal Medicine', 'الباطنية', 8),
('ent', 'ENT', 'أنف وأذن وحنجرة', 9),
('surgery', 'Surgery', 'الجراحة', 10),
('dental', 'Dental', 'الأسنان', 11),
('psychiatry', 'Psychiatry', 'الطب النفسي', 12),
('derma', 'Dermatology', 'الجلدية', 13),
('bones', 'Orthopedics', 'العظام', 14)
ON CONFLICT (id) DO NOTHING;

-- Insert default admin (username: admin, password: admin123 - CHANGE IN PRODUCTION!)
INSERT INTO admin_users (username, password, role) VALUES
('admin', 'admin123', 'admin'),
('superadmin', 'superadmin123', 'superadmin')
ON CONFLICT (username) DO NOTHING;

-- ============================================================================
-- 10. ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Create policies (allow all for service role)
CREATE POLICY IF NOT EXISTS "Allow all" ON clinics FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all" ON patients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all" ON doctors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all" ON admin_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all" ON queues FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all" ON idempotency_keys FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all" ON activity_logs FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 11. CLEANUP JOB (optional - for production)
-- ============================================================================

-- Function to cleanup old data
CREATE OR REPLACE FUNCTION cleanup_old_data(p_days INTEGER DEFAULT 30)
RETURNS TABLE (deleted_queues INTEGER, deleted_logs INTEGER, deleted_idempotency INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted_queues INTEGER := 0;
    v_deleted_logs INTEGER := 0;
    v_deleted_idempotency INTEGER := 0;
BEGIN
    -- Delete old queues
    DELETE FROM queues
    WHERE queue_date < CURRENT_DATE - INTERVAL '1 day' * p_days;
    GET DIAGNOSTICS v_deleted_queues = ROW_COUNT;
    
    -- Delete old activity logs
    DELETE FROM activity_logs
    WHERE created_at < NOW() - INTERVAL '1 day' * p_days;
    GET DIAGNOSTICS v_deleted_logs = ROW_COUNT;
    
    -- Delete expired idempotency keys
    DELETE FROM idempotency_keys
    WHERE expires_at < NOW();
    GET DIAGNOSTICS v_deleted_idempotency = ROW_COUNT;
    
    RETURN QUERY SELECT v_deleted_queues, v_deleted_logs, v_deleted_idempotency;
END;
$$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
