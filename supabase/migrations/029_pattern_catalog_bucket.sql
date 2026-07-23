-- Migration 029: Storage bucket for the Design Studio pattern catalog
--
-- patterns.json is a precomputed, regenerate-from-scratch artifact (see
-- backend/scripts/build-pattern-catalog.ts) — no DB table needed. Public
-- read so the frontend can fetch it directly via the bucket's public URL;
-- writes go through the service-role key only (script upload), which
-- bypasses RLS entirely, so no INSERT/UPDATE policy is added.

insert into storage.buckets (id, name, public)
values ('pattern-catalog', 'pattern-catalog', true)
on conflict (id) do nothing;

create policy "public read pattern-catalog"
on storage.objects for select
using (bucket_id = 'pattern-catalog');
