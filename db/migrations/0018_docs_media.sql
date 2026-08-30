-- 0018_docs_media.sql — a public Storage bucket for images embedded in docs pages.
--
-- Mirrors the `forum-media` bucket (0010) and the `avatars` bucket (0014), with
-- one difference: only master_admin writes documentation, so upload/replace/
-- delete are gated on `public.beleth_role() = 'master_admin'` rather than a
-- per-user folder. Reads are public — the bucket serves images on /docs, which
-- anonymous visitors see.
--
-- The webapp uploads through `POST /api/docs/upload` (master_admin-checked in
-- the route too); the markdown just references the returned public URL, and the
-- docs renderer already allows https `<img>` (src/lib/docs/markdown.ts).
--
-- Idempotent: safe to re-run. Applied by hand:
--   uv run python scripts/apply_migration.py db/migrations/0018_docs_media.sql

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'docs-media', 'docs-media', true, 5242880,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can read (the bucket is public and its images render on the public docs).
drop policy if exists "docs media public read" on storage.objects;
create policy "docs media public read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'docs-media');

-- Only master_admin may add, replace or remove a docs image.
drop policy if exists "docs media admin upload" on storage.objects;
create policy "docs media admin upload"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'docs-media'
    and public.beleth_role() = 'master_admin'
  );

drop policy if exists "docs media admin update" on storage.objects;
create policy "docs media admin update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'docs-media'
    and public.beleth_role() = 'master_admin'
  );

drop policy if exists "docs media admin delete" on storage.objects;
create policy "docs media admin delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'docs-media'
    and public.beleth_role() = 'master_admin'
  );
