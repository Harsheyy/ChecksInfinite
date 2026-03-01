-- The "public read" policy on permutations was missing/dropped in production.
-- Recreate it so the anon key can read rows (needed for the frontend to load).

DROP POLICY IF EXISTS "public read" ON permutations;
CREATE POLICY "public read" ON permutations FOR SELECT USING (true);
