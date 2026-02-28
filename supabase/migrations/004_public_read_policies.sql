-- Allow public read access for the frontend (anon key).
-- checks and permutations are read-only public NFT data — no auth needed.

CREATE POLICY "public read" ON checks      FOR SELECT USING (true);
CREATE POLICY "public read" ON permutations FOR SELECT USING (true);
