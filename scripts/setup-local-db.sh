#!/usr/bin/env bash
# Set up a LOCAL Postgres for dev/test/CI so nothing routine touches the paid
# Neon database. The production DB is only ever hit by the deployed app and by
# release migrations (which load prod creds from .env.release.local).
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

echo ">> push the current schema (all tables) to local"
DATABASE_URL="$URL" npx drizzle-kit push --force

echo ">> install sync revision and workspace cursor triggers"
"$PGBIN/psql" -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<'SQL'
CREATE OR REPLACE FUNCTION bump_revision() RETURNS trigger AS $$
BEGIN
  NEW.revision := nextval('write_change_seq');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER posts_bump_revision BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION bump_revision();

CREATE OR REPLACE TRIGGER folders_bump_revision BEFORE UPDATE ON folders
  FOR EACH ROW EXECUTE FUNCTION bump_revision();

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

echo ">> seed the demo workspace"
DATABASE_URL="$URL" npm run db:seed

echo
echo "Local DB ready: $URL"
echo "Point .env.local DATABASE_URL at it; the app auto-uses the pg driver for a"
echo "non-neon.tech URL. Local revision and workspace cursor behavior now matches"
echo "production so sync and collaboration checks exercise the real contract."
