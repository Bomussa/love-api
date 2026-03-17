-- Queue status lifecycle enforcement
-- Official lifecycle: waiting -> called -> in_service -> completed
-- Legacy mapping: serving -> in_service, in_progress -> in_service

BEGIN;

-- 1) Replace any old status check with official lifecycle-only check
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.queues'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.queues DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;
END
$$;

-- 2) Normalize legacy states before tightening constraints
UPDATE public.queues
SET status = CASE
  WHEN status IN ('serving', 'in_progress') THEN 'in_service'
  WHEN status IN ('cancelled', 'no_show', 'skipped') THEN 'completed'
  ELSE status
END
WHERE status IN ('serving', 'in_progress', 'cancelled', 'no_show', 'skipped');

ALTER TABLE public.queues
  ADD CONSTRAINT queues_status_official_lifecycle_check
  CHECK (status IN ('waiting', 'called', 'in_service', 'completed'));

COMMIT;
