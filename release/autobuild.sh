#!/usr/bin/env bash
# One bounded delivery-controller pass. launchd owns the five-minute cadence.
set -euo pipefail
exec </dev/null

readonly REPO="$HOME/dev/TextText"
readonly GIT="/usr/bin/git"
readonly NPX="/opt/homebrew/bin/npx"
readonly RUN_CAPPED="$HOME/dev/stack/bin/run-capped"
readonly QUIET_SECONDS="${TEXTTEXT_DELIVERY_QUIET_SECONDS:-900}"
readonly PUBLIC_INTERVAL_SECONDS="${TEXTTEXT_DELIVERY_PUBLIC_INTERVAL_SECONDS:-86400}"
readonly LOG="$REPO/release/.autobuild.log"
readonly STATE="$REPO/.texttext/autobuild"
readonly RELEASE_ENV="$HOME/.config/TextText/release.env"

mkdir -p "$STATE"
touch "$LOG"
cd "$REPO"

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >>"$LOG"; }
read_state() { cat "$STATE/$1" 2>/dev/null || true; }
write_state() {
  local temporary="$STATE/$1.new.$$"
  printf '%s\n' "$2" >"$temporary"
  mv "$temporary" "$STATE/$1"
}
clean_tree() {
  "$GIT" diff --quiet &&
    "$GIT" diff --cached --quiet &&
    [ -z "$("$GIT" ls-files --others --exclude-standard)" ]
}
product_changed_since() {
  local baseline="$1"
  [ -z "$baseline" ] && return 0
  "$GIT" merge-base --is-ancestor "$baseline" "$TARGET" 2>/dev/null || return 0
  "$GIT" diff --name-only "$baseline" "$TARGET" |
    /usr/bin/grep -Ev \
      '^(AGENTS\.md|CLAUDE\.md|WORKSHOP\.md|docs/|release/|\.github/|mac/Info\.plist$|src/generated/app-release\.ts$)' |
    /usr/bin/grep -q .
}
receipt_matches_source() {
  "$NPX" tsx scripts/verify-release.ts --check >/dev/null 2>&1
}
held_for_source() {
  [ "$(read_state "failed-$1-source")" = "$TARGET" ]
}
hold_source() {
  write_state "failed-$1-source" "$TARGET"
  log "HOLD: $1 delivery failed for $TARGET; waiting for new source"
}
clear_hold() { rm -f "$STATE/failed-$1-source"; }

[ -x "$RUN_CAPPED" ] || { log "missing run-capped: $RUN_CAPPED"; exit 66; }

if [ -f "$RELEASE_ENV" ]; then
  permissions="$(/usr/bin/stat -f '%Lp' "$RELEASE_ENV")"
  [ "$permissions" = "600" ] || {
    log "refusing release env with mode $permissions; expected 600"
    exit 78
  }
  set -a
  # shellcheck disable=SC1090
  source "$RELEASE_ENV"
  set +a
fi

# A completed release whose final source push failed is retried without a build.
case "$("$GIT" log -1 --format=%s)" in
  "Release TextText"*|"Release TextText"*)
    if clean_tree && [ "$("$GIT" rev-list --count origin/main..HEAD)" -gt 0 ]; then
      "$RUN_CAPPED" --seconds 300 --label texttext-release-push -- \
        "$GIT" push origin main >>"$LOG" 2>&1 || {
          log "release source push remains deferred"
          exit 0
        }
    fi
    ;;
esac

[ "$("$GIT" branch --show-current)" = "main" ] || exit 0
clean_tree || exit 0

TARGET="$("$GIT" rev-parse HEAD)"
INSTALLED="$(read_state installed-source)"
PUBLISHED="$(read_state published-source)"
LAST_PUBLIC_AT="$(read_state last-public-at)"
LAST_PUBLIC_AT="${LAST_PUBLIC_AT:-0}"

if [ -z "$INSTALLED" ] || [ -z "$PUBLISHED" ]; then
  write_state installed-source "$TARGET"
  write_state published-source "$TARGET"
  write_state last-public-at "$(date +%s)"
  log "initialized delivery state at $TARGET"
  exit 0
fi

if [ "$TARGET" != "$INSTALLED" ] && ! product_changed_since "$INSTALLED"; then
  write_state installed-source "$TARGET"
  INSTALLED="$TARGET"
  log "advanced local marker across tooling-only source $TARGET"
fi
if [ "$TARGET" != "$PUBLISHED" ] && ! product_changed_since "$PUBLISHED"; then
  write_state published-source "$TARGET"
  PUBLISHED="$TARGET"
  log "advanced public marker across tooling-only source $TARGET"
fi
[ "$TARGET" = "$INSTALLED" ] && [ "$TARGET" = "$PUBLISHED" ] && exit 0

TARGET_EPOCH="$("$GIT" show -s --format=%ct "$TARGET")"
TARGET_AGE=$(( $(date +%s) - TARGET_EPOCH ))
[ "$TARGET_AGE" -ge "$QUIET_SECONDS" ] || exit 0

receipt_matches_source || {
  log "waiting for exact release-gate receipt for $TARGET"
  exit 0
}

NOW="$(date +%s)"
PUBLIC_DUE=0
if [ "$TARGET" != "$PUBLISHED" ] &&
  [ $((NOW - LAST_PUBLIC_AT)) -ge "$PUBLIC_INTERVAL_SECONDS" ]; then
  PUBLIC_DUE=1
fi

version="$("$NPX" tsx scripts/release-version.mjs next)"
if [ "$PUBLIC_DUE" = "1" ]; then
  held_for_source public && exit 0
  log "public ship $version from $TARGET"
  set +e
  "$RUN_CAPPED" --seconds 10800 --grace 30 --label texttext-public -- \
    "$REPO/release/ship.sh" "$version" --skip-tests >>"$LOG" 2>&1
  result=$?
  set -e
  [ "$result" -eq 75 ] && exit 0
  [ "$result" -eq 0 ] || { hold_source public; exit 0; }
  [ "$("$GIT" rev-parse HEAD)" = "$TARGET" ] || {
    hold_source public
    log "source changed during public ship"
    exit 0
  }
  unexpected="$("$GIT" status --porcelain --untracked-files=no |
    /usr/bin/grep -Ev '^( M|M |MM) (mac/Info\.plist|src/generated/app-release\.ts)$' || true)"
  [ -z "$unexpected" ] || {
    hold_source public
    log "public ship left unexpected tracked changes"
    exit 0
  }
  "$GIT" add mac/Info.plist src/generated/app-release.ts
  "$GIT" commit -q -m "Release TextText $version"
  write_state installed-source "$TARGET"
  write_state published-source "$TARGET"
  write_state last-public-at "$(date +%s)"
  clear_hold public
  clear_hold local
  "$RUN_CAPPED" --seconds 300 --label texttext-release-push -- \
    "$GIT" push origin main >>"$LOG" 2>&1 ||
    log "release source push deferred without rebuilding"
  log "published and installed $version from $TARGET"
elif [ "$TARGET" != "$INSTALLED" ]; then
  held_for_source local && exit 0
  log "local install $version from $TARGET"
  set +e
  "$RUN_CAPPED" --seconds 7200 --grace 30 --label texttext-local -- \
    "$REPO/release/ship.sh" "$version" --skip-tests --local-install >>"$LOG" 2>&1
  result=$?
  set -e
  [ "$result" -eq 75 ] && exit 0
  [ "$result" -eq 0 ] || { hold_source local; exit 0; }
  [ "$("$GIT" rev-parse HEAD)" = "$TARGET" ] && clean_tree || {
    hold_source local
    log "source changed during local install"
    exit 0
  }
  write_state installed-source "$TARGET"
  clear_hold local
  log "installed $version locally from $TARGET"
fi
