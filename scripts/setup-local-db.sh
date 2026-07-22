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

echo ">> raw objects Drizzle does not manage (the monotonic change sequence)"
"$PGBIN/psql" -d "$DB" -c "CREATE SEQUENCE IF NOT EXISTS write_change_seq;" >/dev/null

echo ">> push the current schema (all tables) to local"
DATABASE_URL="$URL" npx drizzle-kit push --force

echo ">> seed the demo workspace"
DATABASE_URL="$URL" npm run db:seed

echo
echo "Local DB ready: $URL"
echo "Point .env.local DATABASE_URL at it; the app auto-uses the pg driver for a"
echo "non-neon.tech URL. Revision/slug-history triggers are applied to PROD by the"
echo "release migrations; local dev does not need them for normal CRUD."
