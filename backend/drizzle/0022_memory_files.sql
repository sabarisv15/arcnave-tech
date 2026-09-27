-- ADR-0047: memory is a set of Markdown files, keyed by path. A topic saved before ("Work")
-- becomes /topics/work.md; two topics that slug the same get -2, -3 in creation order.
UPDATE "memory_items" m
SET "key" = '/topics/' || s.slug || CASE WHEN s.rn > 1 THEN '-' || s.rn::text ELSE '' END || '.md'
FROM (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, scope, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), slug
           ORDER BY created_at, id
         ) AS rn,
         slug
  FROM (
    SELECT id, user_id, scope, project_id, created_at,
           coalesce(nullif(left(trim(both '-' from lower(regexp_replace("key", '[^a-zA-Z0-9]+', '-', 'g'))), 150), ''), 'note') AS slug
    FROM "memory_items"
    WHERE "key" NOT LIKE '/%'
  ) x
) s
WHERE m.id = s.id;
