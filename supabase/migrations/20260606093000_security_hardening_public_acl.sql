-- Security hardening migration
-- Goal: remove public/anon bypass paths from SECURITY DEFINER RPCs and permissive write policies
-- while preserving existing read contracts where the frontend depends on them.

BEGIN;

-- Force RLS on sensitive tables that have been exposed too broadly in prior revisions.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'admin_users',
    'login_audit',
    'activity_logs',
    'api_logs',
    'patients',
    'clinics',
    'settings',
    'system_config'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;
END $$;

-- Harden historical unified_queue partitions without touching the active runtime table.
DO $$
DECLARE
  rel record;
BEGIN
  FOR rel IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname LIKE 'unified_queue_2026_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel.table_name);
  END LOOP;
END $$;

-- Drop permissive non-SELECT policies that used true / always-allow semantics.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'admin_users',
        'login_audit',
        'activity_logs',
        'api_logs',
        'patients',
        'clinics',
        'settings',
        'system_config'
      )
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (COALESCE(qual, '') = 'true' OR COALESCE(with_check, '') = 'true')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;

  FOR p IN
    SELECT p2.schemaname, p2.tablename, p2.policyname
    FROM pg_policies p2
    JOIN pg_class c ON c.relname = p2.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p2.schemaname
    WHERE p2.schemaname = 'public'
      AND p2.tablename LIKE 'unified_queue_2026_%'
      AND p2.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (COALESCE(p2.qual, '') = 'true' OR COALESCE(p2.with_check, '') = 'true')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.schemaname, p.schemaname, p.tablename);
  END LOOP;
END $$;

-- Revoke EXECUTE from public-facing roles on known SECURITY DEFINER functions.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS function_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_auth_login',
        'create_admin_user',
        'delete_admin_user',
        'update_admin_user',
        'list_admin_users',
        'admin_login_check',
        'verify_clinic_pin',
        'enter_unified_queue',
        'enter_unified_queue_safe',
        'call_next_patient_safe',
        'cancel_queue_entry',
        'complete_exam_safe',
        'add_to_queue_atomic'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      f.schema_name,
      f.function_name,
      f.function_args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
      f.schema_name,
      f.function_name,
      f.function_args
    );
  END LOOP;
END $$;

-- Guardrail: abort if any permissive non-SELECT write policy remains on the hardened tables.
DO $$
DECLARE
  remaining_count integer;
BEGIN
  SELECT count(*)
    INTO remaining_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      tablename IN (
        'admin_users',
        'login_audit',
        'activity_logs',
        'api_logs',
        'patients',
        'clinics',
        'settings',
        'system_config'
      )
      OR tablename LIKE 'unified_queue_2026_%'
    )
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    AND (COALESCE(qual, '') = 'true' OR COALESCE(with_check, '') = 'true');

  IF remaining_count > 0 THEN
    RAISE EXCEPTION 'Security hardening failed: permissive public write policies remain on hardened tables.';
  END IF;
END $$;

COMMIT;
