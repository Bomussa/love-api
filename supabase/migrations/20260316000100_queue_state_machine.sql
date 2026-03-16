-- Queue state machine normalization
-- Official flow: waiting -> called -> in_service -> completed

-- 1) Map legacy statuses to canonical states
UPDATE public.queues
SET status = CASE status::text
  WHEN 'serving' THEN 'in_service'::public.queue_status
  WHEN 'in_progress' THEN 'in_service'::public.queue_status
  WHEN 'done' THEN 'completed'::public.queue_status
  WHEN 'skipped' THEN 'completed'::public.queue_status
  ELSE status
END
WHERE status::text IN ('serving', 'in_progress', 'done', 'skipped');

-- 2) Enforce allowed status set at table level
ALTER TABLE public.queues
  DROP CONSTRAINT IF EXISTS queues_status_official_check;

ALTER TABLE public.queues
  ADD CONSTRAINT queues_status_official_check
  CHECK (status::text IN ('waiting', 'called', 'in_service', 'completed'));

-- 3) Enforce strict transition path
CREATE OR REPLACE FUNCTION public.assert_queue_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old text;
  v_new text;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.status IS NULL OR OLD.status IS NULL THEN
    RETURN NEW;
  END IF;

  v_old := OLD.status::text;
  v_new := NEW.status::text;

  IF v_old = v_new THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (v_old = 'waiting' AND v_new = 'called') OR
    (v_old = 'called' AND v_new = 'in_service') OR
    (v_old = 'in_service' AND v_new = 'completed')
  ) THEN
    RAISE EXCEPTION 'INVALID_QUEUE_STATUS_TRANSITION: % -> %', v_old, v_new;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_queue_status_transition ON public.queues;

CREATE TRIGGER trg_assert_queue_status_transition
  BEFORE UPDATE OF status ON public.queues
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_queue_status_transition();
