#!/usr/bin/env node
// Additive, idempotent migration for the canonical document snapshot,
// immutable templates, explicit visibility, capability links, relative comment
// anchors, and collaboration awareness.

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping unified document migration.");
  process.exit(0);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes(".neon.tech") ? { rejectUnauthorized: true } : undefined,
});

async function query(text) {
  return client.query(text);
}

async function main() {
  await client.connect();
  const table = await query(
    "SELECT to_regclass('public.posts') AS posts_table",
  );
  if (!table.rows[0]?.posts_table) {
    console.log(
      "Posts table does not exist yet; canonical document backfill will run after schema creation.",
    );
    await client.end();
    return;
  }
  await query("BEGIN");
  try {
    await query(`
      ALTER TABLE folders
        ADD COLUMN IF NOT EXISTS default_template_id text NOT NULL
          DEFAULT 'texttext.article',
        ADD COLUMN IF NOT EXISTS default_template_version integer NOT NULL
          DEFAULT 1
    `);
    await query(`
      UPDATE folders
      SET default_template_id = CASE mode
        WHEN 'notes' THEN 'texttext.note'
        WHEN 'bookmarks' THEN 'texttext.bookmark'
        ELSE 'texttext.article'
      END,
      default_template_version = 1
      WHERE default_template_id = 'texttext.article'
        AND default_template_version = 1
    `);

    await query(`
      ALTER TABLE posts
        ADD COLUMN IF NOT EXISTS document jsonb,
        ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private',
        ADD COLUMN IF NOT EXISTS template_id text NOT NULL DEFAULT 'texttext.article',
        ADD COLUMN IF NOT EXISTS template_version integer NOT NULL DEFAULT 1
    `);
    await query(`
      UPDATE posts
      SET template_id = CASE type::text
        WHEN 'note' THEN 'texttext.note'
        WHEN 'bookmark' THEN 'texttext.bookmark'
        WHEN 'project' THEN 'texttext.gallery'
        WHEN 'talk' THEN 'texttext.talk'
        ELSE 'texttext.article'
      END,
      template_version = 1,
      visibility = CASE
        WHEN status::text = 'published'
          AND type::text NOT IN ('note', 'bookmark') THEN 'public'
        ELSE 'private'
      END
      WHERE document IS NULL
    `);
    await query(`
      UPDATE posts p
      SET document = jsonb_build_object(
        'schemaVersion', 1,
        'content', jsonb_strip_nulls(jsonb_build_object(
          'title', coalesce(p.title, ''),
          'subtitle', nullif(p.excerpt, ''),
          'body', coalesce(p.body, ''),
          'fields', jsonb_strip_nulls(jsonb_build_object(
            'cover', nullif(p.cover, ''),
            'videoUrl', nullif(p.video_url, ''),
            'sourceUrl', coalesce(
              nullif(p.capture ->> 'url', ''),
              nullif(p.links -> 0 ->> 'href', '')
            ),
            'venue', nullif(p.venue, ''),
            'duration', nullif(p.duration, '')
          )),
          'tags', coalesce(to_jsonb(p.tags), '[]'::jsonb),
          'assets', coalesce((
            SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', 'gallery-' || gallery.ordinality::text,
              'kind', CASE
                WHEN coalesce(gallery.item ->> 'src', '') ~* '\\.(mp4|webm|mov|m4v|ogv|ogg)([?#].*)?$'
                  THEN 'video'
                ELSE 'image'
              END,
              'src', gallery.item ->> 'src',
              'caption', nullif(gallery.item ->> 'caption', '')
            )))
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(p.gallery) = 'array'
                THEN p.gallery ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS gallery(item, ordinality)
            WHERE length(coalesce(gallery.item ->> 'src', '')) > 0
          ), '[]'::jsonb)
        )),
        'presentation', jsonb_build_object(
          'template', jsonb_build_object(
            'id', p.template_id,
            'version', p.template_version
          ),
          'theme', jsonb_strip_nulls(jsonb_build_object(
            'accent', CASE
              WHEN p.accent ~ '^#[0-9a-fA-F]{6}$' THEN p.accent
              ELSE NULL
            END
          ))
        )
      )
      WHERE p.document IS NULL
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS document_templates (
        blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
        template_id text NOT NULL,
        version integer NOT NULL,
        name text NOT NULL,
        definition jsonb NOT NULL,
        created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT document_templates_blog_template_version_pk
          PRIMARY KEY (blog_id, template_id, version),
        CONSTRAINT document_templates_version_positive CHECK (version > 0)
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS document_capability_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        token_hash text NOT NULL,
        role text NOT NULL DEFAULT 'viewer',
        label text,
        created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        expires_at timestamp,
        last_used_at timestamp,
        revoked_at timestamp,
        CONSTRAINT document_capability_links_role_valid
          CHECK (role IN ('viewer', 'commenter', 'editor'))
      )
    `);
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS document_capability_links_token_hash_idx
        ON document_capability_links (token_hash)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS document_capability_links_post_active_idx
        ON document_capability_links (post_id, created_at)
        WHERE revoked_at IS NULL
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS posts_blog_visibility_order_idx
        ON posts (
          blog_id,
          visibility,
          status,
          pinned DESC,
          published_at DESC,
          created_at DESC
        )
        WHERE deleted_at IS NULL
    `);
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'posts_visibility_valid'
        ) THEN
          ALTER TABLE posts ADD CONSTRAINT posts_visibility_valid
            CHECK (visibility IN ('private', 'link', 'public'));
        END IF;
      END
      $$
    `);

    await query(`
      ALTER TABLE item_comments
        ADD COLUMN IF NOT EXISTS anchor_start_relative text,
        ADD COLUMN IF NOT EXISTS anchor_end_relative text
    `);
    await query(`
      ALTER TABLE collab_presence
        ADD COLUMN IF NOT EXISTS awareness text
    `);
    await query(`
      ALTER TABLE collab_state
        ADD COLUMN IF NOT EXISTS baseline_update text,
        ADD COLUMN IF NOT EXISTS baseline_revision bigint
    `);

    const result = await query(`
      SELECT
        count(*)::int AS documents,
        count(*) FILTER (WHERE visibility = 'public')::int AS public_documents,
        count(*) FILTER (WHERE visibility = 'link')::int AS link_documents,
        count(*) FILTER (WHERE visibility = 'private')::int AS private_documents,
        count(*) FILTER (WHERE document IS NULL)::int AS missing_documents
      FROM posts
    `);
    if (result.rows[0]?.missing_documents !== 0) {
      throw new Error("Unified document backfill left rows without a document snapshot");
    }
    await query("COMMIT");
    const summary = result.rows[0];
    console.log(
      `Unified documents ready. documents=${summary.documents} ` +
        `public=${summary.public_documents} link=${summary.link_documents} ` +
        `private=${summary.private_documents}`,
    );
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
