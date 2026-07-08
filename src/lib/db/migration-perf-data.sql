ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS word_count integer;

CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_folder_id_idx
  ON posts (folder_id)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_blog_public_order_idx
  ON posts (blog_id, status, pinned DESC, published_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_blog_workspace_order_idx
  ON posts (blog_id, pinned DESC, updated_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS collaborators_user_id_active_idx
  ON collaborators (user_id)
  WHERE revoked_at IS NULL
    AND user_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS collaborators_invited_email_active_idx
  ON collaborators (invited_email)
  WHERE revoked_at IS NULL
    AND invited_email IS NOT NULL
    AND user_id IS NULL;

WITH system_folders(name, path, mode, position) AS (
  VALUES
    ('Blog', 'blog', 'blog', 0),
    ('Notes', 'notes', 'notes', 1),
    ('Bookmarks', 'bookmarks', 'bookmarks', 2)
)
INSERT INTO folders (blog_id, name, path, mode, position)
SELECT b.id, sf.name, sf.path, sf.mode, sf.position
FROM blogs b
CROSS JOIN system_folders sf
WHERE b.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM folders f
    WHERE f.blog_id = b.id
      AND f.path = sf.path
      AND f.deleted_at IS NULL
  )
ON CONFLICT DO NOTHING;

UPDATE posts
SET word_count = CASE
  WHEN btrim(body) = '' THEN 0
  ELSE cardinality(regexp_split_to_array(btrim(body), '[[:space:]]+'))
END
WHERE word_count IS NULL;
