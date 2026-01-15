CREATE OR REPLACE FUNCTION generate_daily_pins()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO clinic_pins (clinic_id, pin, pin_date, is_active)
  SELECT id, floor(1000 + random()*9000)::text, current_date, true
  FROM clinics
  ON CONFLICT (clinic_id, pin_date) DO NOTHING;
END;
$$;
