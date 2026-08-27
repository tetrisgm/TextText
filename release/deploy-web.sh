#!/usr/bin/env bash
# Ship the web app, and only the web app, without leaving production broken.
#
#   release/deploy-web.sh
#   release/deploy-web.sh --dry-run     build and verify nothing is promoted
#
# This is NOT a release. It cuts no Mac version, touches no appcast, and
# uploads nothing to a store. Use release/ship.sh for that.
#
# It exists because a hand-run `vercel build && vercel deploy --prod` is three
# steps short of safe, and on 2026-08-27 all three bit at once:
#
#   1. The database was behind the build. ship.sh migrates first; a hand deploy
#      does not, so a build whose schema expected api_tokens.kind went live
#      against a database without it. Every HTML route answered 200 and the Mac
#      app could not open at all, because the only request that reached the
#      broken query was its session exchange.
#   2. The custom domain does not follow a CLI deploy. texttext.app is an alias
#      that has to be promoted, and "deployed" read as "live" while the old
#      build was still serving.
#   3. Nothing checked. The breakage was found by looking at the app.
#
# So: migrate, build, deploy, remember what was live, promote, verify, and put
# the old one back if the verification fails.
set -euo pipefail
exec </dev/null
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

. "$ROOT/release/secrets.sh"

echo ">> release credentials"
require_release_secret DATABASE_URL
require_release_secret BLOB_READ_WRITE_TOKEN
case "${DATABASE_URL:-}" in
  *neon.tech*) ;;
  *) echo "Refusing: DATABASE_URL is not the production Neon database." >&2; exit 1 ;;
esac

# The database must never be behind the build. These are idempotent and
# additive, so running them while the previous build still serves is safe.
echo ">> migrate the production database"
DATABASE_URL="$DATABASE_URL" "$ROOT/scripts/run-release-migrations.sh"

# A local dev server writes .next while this build wants to. The first run of
# this script deployed an output built alongside `npm run dev` and Vercel
# rejected it with no message at all.
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "A dev server is running on :3000 and writes .next while this builds." >&2
  echo "Stop it, then run this again." >&2
  exit 1
fi

# What the DOMAIN serves right now, so a failed verification has somewhere to
# go back to. Not the newest deployment: after a deploy that is the new one,
# and rolling back to it would be a no-op dressed as a recovery.
PREVIOUS="$(npx vercel inspect texttext.app 2>&1 \
  | grep -Eo 'https://write-[a-z0-9-]+\.vercel\.app' | head -1)"
[ -n "$PREVIOUS" ] || { echo "Could not read what texttext.app is serving." >&2; exit 1; }
echo ">> currently live: $PREVIOUS"

# Unique per DEPLOY, not per commit: Vercel refuses a user-configured
# deployment id it has seen before, so re-deploying the same commit failed with
# "already exists in this project" and no production change at all. The commit
# is still in the id, which is the point of stamping it.
COMMIT="$(git rev-parse --short HEAD)"
export NEXT_DEPLOYMENT_ID="texttext-$COMMIT-$(date +%s)"
echo ">> build $NEXT_DEPLOYMENT_ID"
npx vercel build --prod --yes > /dev/null

if [ "$DRY_RUN" = "1" ]; then
  echo ">> dry run: built, nothing deployed"
  exit 0
fi

echo ">> deploy"
NEW="$(npx vercel deploy --prebuilt --prod --yes 2>&1 \
  | grep -Eo 'https://[a-z0-9-]+\.vercel\.app' | tail -1)"
[ -n "$NEW" ] || { echo "Could not read the new deployment URL." >&2; exit 1; }
echo ">> deployed: $NEW"

# `vercel deploy --prod` sometimes takes the domain on its own and sometimes
# does not, so promote either way. When it has already taken it, promote exits
# 409 "already the current production deployment", which is success wearing a
# failure's clothes: under set -e that aborted the script BEFORE the
# verification, leaving an unchecked build live. That is the one outcome this
# script exists to prevent.
echo ">> promote"
PROMOTE_OUTPUT="$(npx vercel promote "$NEW" 2>&1)" || {
  case "$PROMOTE_OUTPUT" in
    *"already the current production deployment"*)
      echo "   (the deploy had already taken the domain)" ;;
    *)
      echo "$PROMOTE_OUTPUT" >&2
      echo "!! could not promote; $PREVIOUS is still live" >&2
      exit 1 ;;
  esac
}

# A promote is not instant. Wait to SEE the new build before believing it.
echo ">> wait for the domain to serve it"
SERVING=""
for attempt in $(seq 1 30); do
  SERVING="$(curl -fsS -H 'cache-control: no-cache' \
    "https://texttext.app/signin?promote_check=$attempt" 2>/dev/null \
    | grep -o 'dpl=[A-Za-z0-9_-]*' | head -1 | cut -d= -f2 || true)"
  [ "$SERVING" = "$NEXT_DEPLOYMENT_ID" ] && break
  sleep 4
done

echo ">> verify"
if npx tsx "$ROOT/scripts/verify-deployment.ts" https://texttext.app \
    --expect-dpl "$NEXT_DEPLOYMENT_ID"; then
  echo
  echo "Live: $NEW ($NEXT_DEPLOYMENT_ID)"
  # vercel build writes .next as well, and that build has no dev sign-in in it
  # because the production env has no AUTH_DEV_LOGIN. Anything that serves
  # .next locally is now serving that. eval:sidebar is the one that does.
  echo "Note: .next now holds a production build with no dev sign-in."
  echo "      Run 'npm run build' before eval:sidebar or eval:item-type."
  exit 0
fi

echo
echo "!! verification failed; putting $PREVIOUS back" >&2
npx vercel promote "$PREVIOUS" > /dev/null
sleep 5
npx tsx "$ROOT/scripts/verify-deployment.ts" https://texttext.app || true
echo "Rolled back to $PREVIOUS. The new build stays deployed at $NEW." >&2
exit 1
