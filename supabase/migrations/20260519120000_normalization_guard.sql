-- Normalization guard migration
-- Purpose: fail fast when production schema drifts from canonical contracts.

DO $$
DECLARE
  missing_count integer;
BEGIN
  -- Required tables
  SELECT count(*) INTO missing_count
  FROM (
    VALUES
      ('admin_users'),
      ('patients'),
      ('queues'),
      ('routes'),
      ('route_steps'),
      ('notifications'),
      ('system_config')
  ) AS required_tables(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_name = required_tables.table_name
  );

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Normalization guard failed: required public tables are missing.';
  END IF;

  -- Required columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'queues' AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION 'Normalization guard failed: public.queues.status is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'is_read'
  ) THEN
    RAISE EXCEPTION 'Normalization guard failed: public.notifications.is_read is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'route_steps' AND column_name = 'route_id'
  ) THEN
    RAISE EXCEPTION 'Normalization guard failed: public.route_steps.route_id is missing.';
  END IF;

  -- Required RLS enablement + policy presence
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'notifications'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'Normalization guard failed: RLS is not enabled on public.notifications.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_insert_open'
  ) THEN
    RAISE EXCEPTION 'Normalization guard failed: policy public.notifications_insert_open is missing.';
  END IF;

  RAISE NOTICE 'Normalization guard passed: schema contracts are present.';
END;
$$;
