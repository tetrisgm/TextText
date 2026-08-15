#!/usr/bin/env bash
# Set up a LOCAL Postgres for dev/test/CI so nothing routine touches the paid
# Neon database. The production DB is only ever hit by the deployed app and by
# release migrations (which load prod creds from the login Keychain).
#
# One-time: brew install postgresql@17 && brew services start postgresql@17
# Then:      bash scripts/setup-local-db.sh
# Finally:   set .env.local DATABASE_URL=postgres://$(whoami)@localhost:5432/texttext_dev
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${LOCAL_PG_DB:-texttext_dev}"
PGBIN="$(brew --prefix 2>/dev/null)/opt/postgresql@17/bin"
[ -x "$PGBIN/psql" ] || PGBIN="$(dirname "$(command -v psql)")"
URL="postgres://$(whoami)@localhost:5432/$DB"

echo ">> create database $DB (if missing)"
"$PGBIN/createdb" "$DB" 2>/dev/null || echo "   (already exists)"

echo ">> convert existing documents before applying stricter schema constraints"
DATABASE_URL="$URL" node scripts/migrate-unified-documents.mjs
DATABASE_URL="$URL" node scripts/migrate-enforce-canonical-documents.mjs

echo ">> push the current schema (all tables) to local"
DATABASE_URL="$URL" npx drizzle-kit push --force

echo ">> enforce and audit canonical documents after schema creation"
DATABASE_URL="$URL" node scripts/migrate-unified-documents.mjs
DATABASE_URL="$URL" node scripts/migrate-enforce-canonical-documents.mjs
DATABASE_URL="$URL" npx tsx scripts/audit-canonical-documents.ts

echo ">> install sync revision, slug history, and workspace cursor triggers"
"$PGBIN/psql" -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<'SQL'
CREATE SEQUENCE IF NOT EXISTS texttext_change_seq;

CREATE OR REPLACE FUNCTION bump_revision() RETURNS trigger AS $$
BEGIN
  NEW.revision := nextval('texttext_change_seq');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER posts_bump_revision BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION bump_revision();

CREATE OR REPLACE TRIGGER folders_bump_revision BEFORE UPDATE ON folders
  FOR EACH ROW EXECUTE FUNCTION bump_revision();

CREATE OR REPLACE FUNCTION track_post_slug_history() RETURNS trigger AS $$
DECLARE
  candidate text;
  history text[] := ARRAY[]::text[];
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    FOREACH candidate IN ARRAY
      array_prepend(OLD.slug, COALESCE(OLD.slug_history, ARRAY[]::text[]))
    LOOP
      IF candidate IS NOT NULL
         AND candidate <> ''
         AND candidate <> NEW.slug
         AND NOT (candidate = ANY(history)) THEN
        history := array_append(history, candidate);
        EXIT WHEN cardinality(history) >= 20;
      END IF;
    END LOOP;
    NEW.slug_history := history;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER posts_track_slug_history
  BEFORE UPDATE OF slug ON posts
  FOR EACH ROW EXECUTE FUNCTION track_post_slug_history();

CREATE OR REPLACE FUNCTION bump_blog_change_seq() RETURNS trigger AS $$
BEGIN
  UPDATE blogs SET change_seq = NEW.revision
    WHERE id = NEW.blog_id AND change_seq < NEW.revision;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER posts_bump_blog_seq AFTER INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION bump_blog_change_seq();

CREATE OR REPLACE TRIGGER folders_bump_blog_seq AFTER INSERT OR UPDATE ON folders
  FOR EACH ROW EXECUTE FUNCTION bump_blog_change_seq();

UPDATE blogs SET change_seq = GREATEST(
  change_seq,
  coalesce((SELECT max(revision) FROM posts WHERE blog_id = blogs.id), 0),
  coalesce((SELECT max(revision) FROM folders WHERE blog_id = blogs.id), 0)
);
SQL

echo
echo "Local DB ready: $URL"
echo "The database starts empty; signing in provisions your workspace."
echo "Point .env.local DATABASE_URL at it; the app auto-uses the pg driver for a"
echo "non-neon.tech URL. Local revision and workspace cursor behavior now matches"
echo "production so sync and collaboration checks exercise the real contract."
