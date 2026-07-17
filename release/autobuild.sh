#!/bin/bash
# Autobuild daemon for Write. Whenever main holds committed work newer than the
# last release, auto-bump and run the full ship. No prompts, ever. Runs via
# launchd (release/install-autobuild.sh).
#
# Design: "needs ship" is derived from GIT STATE, not an in-memory marker, so a
# failed ship, a daemon restart, or a machine reboot can never strand unshipped
# work: if HEAD's subject is not a "Release Write" commit, there is unshipped
# work and the daemon keeps trying (with backoff) until a ship succeeds.
#   - Debounce: HEAD must be stable for DEBOUNCE seconds (a burst = one build).
#   - Clean-tree only: never ship a mid-edit or uncommitted state.
#   - Failure recovery: restore the aborted version bump so the tree is clean,
#     back off, retry.
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/.npm-global/bin"
REPO="$HOME/dev/write"
POLL=20
DEBOUNCE=45
FAIL_BACKOFF=600
LOG="$REPO/release/.autobuild.log"

cd "$REPO" || exit 1
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

clean() {
  git diff --quiet && git diff --cached --quiet \
    && [ -z "$(git ls-files --others --exclude-standard)" ]
}

# Unshipped work exists whenever HEAD is not itself a release commit.
needs_ship() {
  case "$(git log -1 --format=%s)" in
    "Release Write"*) return 1 ;;
    *) return 0 ;;
  esac
}

next_version() {
  local v
  v=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' mac/Info.plist)
  echo "${v%.*}.$(( ${v##*.} + 1 ))"
}

restore_bump() {
  git checkout -- mac/Info.plist src/generated/app-release.ts 2>/dev/null || true
}

log "autobuild started (git-derived); HEAD $(git rev-parse --short HEAD)"

while true; do
  sleep "$POLL"
  needs_ship || continue
  if ! clean; then
    continue # work in progress; wait for the commit
  fi

  # Debounce: let a burst of commits settle into ONE build.
  stable=$(git rev-parse HEAD)
  while true; do
    sleep "$DEBOUNCE"
    now=$(git rev-parse HEAD)
    [ "$now" = "$stable" ] && break
    stable="$now"
  done
  clean || continue
  needs_ship || continue

  ver=$(next_version)
  log "shipping $ver (HEAD $stable)"
  if ./release/ship.sh "$ver" >> "$LOG" 2>&1; then
    git add mac/Info.plist src/generated/app-release.ts 2>/dev/null
    git commit -q -m "Release Write $ver" 2>>"$LOG"
    git push origin main >> "$LOG" 2>&1
    log "shipped $ver and pushed"
  else
    rc=$?
    restore_bump
    log "ship $ver FAILED (exit $rc); bump restored, retrying in ${FAIL_BACKOFF}s"
    sleep "$FAIL_BACKOFF"
  fi
done
