-- Safe hardening migration: phase 1 adds strict policies and audit guard.
-- Deploy with API error monitoring before revoking legacy anon write grants in production.

BEGIN;

-- 1) Minimize anon grants (read-only).
REVOKE INSERT, UPDATE, DELETE ON TABLE public.patients, public.queues, public.pathways, public.notifications FROM anon;
GRANT SELECT ON TABLE public.clinics, public.reports TO anon;

-- 2) Guardrail function: fail migration if a broad write policy exists.
CREATE OR REPLACE FUNCTION public.assert_no_public_write_policies()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    AND (
      coalesce(btrim(p.qual), '') IN ('true', '(true)')
      OR coalesce(btrim(p.with_check), '') IN ('true', '(true)')
    );

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Unsafe public write RLS policies detected: %', v_count
      USING HINT = 'Replace USING/WITH CHECK true with identity/role/ownership predicates.';
  END IF;
END;
$$;

-- 3) Enforce now and in future migrations.
SELECT public.assert_no_public_write_policies();

COMMIT;
