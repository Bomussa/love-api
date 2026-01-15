CREATE TABLE IF NOT EXISTS admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id)
);

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_only"
ON admins
FOR ALL
USING (auth.uid() IN (SELECT user_id FROM admins));
