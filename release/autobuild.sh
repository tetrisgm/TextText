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
#   - Supersession: abandon an active ship when HEAD advances, then build only
#     the latest commit.
#   - Failure recovery: restore the aborted version bump so the tree is clean.
#     Back off only while the broken commit remains at HEAD.
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

# ship.sh starts several layers of child processes. Stop descendants before
# their parent so an abandoned build cannot leave work running in the
# background. Limit every signal to the known ship process tree.
kill_process_tree() {
  local pid="$1"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_process_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
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
  [ "$(git rev-parse HEAD)" = "$stable" ] || continue

  ver=$(next_version)
  log "shipping $ver (HEAD $stable)"
  ./release/ship.sh "$ver" >> "$LOG" 2>&1 &
  ship_pid=$!
  superseded=0

  while kill -0 "$ship_pid" 2>/dev/null; do
    sleep "$POLL"
    now=$(git rev-parse HEAD)
    if [ "$now" != "$stable" ]; then
      log "ship $ver superseded by HEAD $now; cancelling process tree $ship_pid"
      kill_process_tree "$ship_pid"
      wait "$ship_pid" 2>/dev/null || true
      restore_bump
      log "ship $ver abandoned; bump restored, rebuilding latest HEAD"
      superseded=1
      break
    fi
  done

  [ "$superseded" -eq 0 ] || continue

  ship_rc=0
  wait "$ship_pid" || ship_rc=$?
  now=$(git rev-parse HEAD)
  if [ "$now" != "$stable" ]; then
    restore_bump
    log "ship $ver finished after HEAD advanced to $now; bump restored, rebuilding latest HEAD"
    continue
  fi

  if [ "$ship_rc" -eq 0 ]; then
    git add mac/Info.plist src/generated/app-release.ts 2>/dev/null
    git commit -q -m "Release Write $ver" 2>>"$LOG"
    git push origin main >> "$LOG" 2>&1
    log "shipped $ver and pushed"
  else
    restore_bump
    log "ship $ver FAILED (exit $ship_rc); bump restored, retrying in ${FAIL_BACKOFF}s"
    sleep "$FAIL_BACKOFF"
  fi
done
