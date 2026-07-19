#!/bin/bash
# Ship one clean, verified main commit once. launchd owns liveness; this loop
# only detects a ready source and hands it to the deterministic ship command.
set -euo pipefail
exec </dev/null

readonly REPO="$HOME/dev/write"
readonly GIT="/usr/bin/git"
readonly NPX="/opt/homebrew/bin/npx"
readonly POLL_SECONDS=30
readonly DEBOUNCE_SECONDS=45
readonly LOG="$REPO/release/.autobuild.log"
readonly STATE="$REPO/.write/autobuild"
readonly FAILED_SOURCE="$STATE/failed-source"
readonly RELEASE_ENV="$HOME/.config/write/release.env"

cd "$REPO" || exit 1
mkdir -p "$STATE"
touch "$LOG"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
}

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"Write delivery\"" \
    >/dev/null 2>&1 || true
}

if [ -f "$RELEASE_ENV" ]; then
  permissions="$(/usr/bin/stat -f '%Lp' "$RELEASE_ENV")"
  if [ "$permissions" != "600" ]; then
    log "refusing release env with mode $permissions; expected 600"
    exit 78
  fi
  set -a
  # shellcheck disable=SC1090
  source "$RELEASE_ENV"
  set +a
fi

clean_tree() {
  "$GIT" diff --quiet && "$GIT" diff --cached --quiet \
    && [ -z "$("$GIT" ls-files --others --exclude-standard)" ]
}

needs_ship() {
  case "$("$GIT" log -1 --format=%s)" in
    "Release Write"*) return 1 ;;
    *) return 0 ;;
  esac
}

receipt_matches_source() {
  "$NPX" tsx scripts/verify-release.ts --check >/dev/null 2>&1
}

push_release_commit() {
  if ! clean_tree; then return 0; fi
  case "$("$GIT" log -1 --format=%s)" in
    "Release Write"*) ;;
    *) return 0 ;;
  esac
  if [ "$("$GIT" rev-list --count origin/main..HEAD)" -eq 0 ]; then return 0; fi
  log "retrying push for release commit $("$GIT" rev-parse HEAD)"
  if "$NPX" tsx scripts/work-unit.ts run \
    --name autobuild.git_push --timeout 300 --no-reuse -- \
    "$GIT" push origin main >> "$LOG" 2>&1; then
    log "release commit pushed"
  else
    log "release commit push failed; launchd will retry without rebuilding"
  fi
}

log "autobuild started; HEAD $("$GIT" rev-parse --short HEAD)"

while true; do
  sleep "$POLL_SECONDS"
  push_release_commit
  needs_ship || continue
  clean_tree || continue
  receipt_matches_source || continue

  source_commit="$("$GIT" rev-parse HEAD)"
  if [ -f "$FAILED_SOURCE" ] \
    && [ "$(cat "$FAILED_SOURCE")" = "$source_commit" ]; then
    continue
  fi

  sleep "$DEBOUNCE_SECONDS"
  [ "$("$GIT" rev-parse HEAD)" = "$source_commit" ] || continue
  clean_tree || continue
  receipt_matches_source || continue

  version="$($NPX tsx scripts/release-version.mjs next)"
  log "shipping $version from $source_commit"
  set +e
  "$NPX" tsx scripts/work-unit.ts run \
    --name "autobuild.ship.$source_commit" --timeout 10800 --no-reuse -- \
    "$REPO/release/ship.sh" "$version" --skip-tests >> "$LOG" 2>&1
  ship_status=$?
  set -e

  if [ "$ship_status" -eq 75 ]; then
    log "delivery lane busy; deferring $source_commit"
    continue
  fi
  if [ "$ship_status" -ne 0 ]; then
    printf '%s\n' "$source_commit" > "$FAILED_SOURCE"
    log "ship failed once with exit $ship_status; holding $source_commit"
    notify "Ship $version failed once and is held until the source changes."
    continue
  fi

  if [ "$("$GIT" rev-parse HEAD)" != "$source_commit" ]; then
    printf '%s\n' "$source_commit" > "$FAILED_SOURCE"
    log "source changed during ship; preserving the result for review"
    notify "Source changed during ship. Review the release before continuing."
    continue
  fi

  unexpected="$($GIT status --porcelain --untracked-files=no \
    | /usr/bin/grep -Ev '^( M|M |MM) (mac/Info.plist|src/generated/app-release.ts)$' || true)"
  if [ -n "$unexpected" ]; then
    printf '%s\n' "$source_commit" > "$FAILED_SOURCE"
    log "ship left unexpected tracked changes; preserving them for review"
    notify "Ship $version left unexpected source changes and was not committed."
    continue
  fi

  "$GIT" add mac/Info.plist src/generated/app-release.ts
  "$GIT" commit -q -m "Release Write $version"
  rm -f "$FAILED_SOURCE"
  if "$NPX" tsx scripts/work-unit.ts run \
    --name autobuild.git_push --timeout 300 --no-reuse -- \
    "$GIT" push origin main >> "$LOG" 2>&1; then
    log "shipped $version and pushed"
  else
    log "shipped $version; push deferred without rebuilding"
    notify "Write $version shipped, but its source push will retry."
  fi
done
