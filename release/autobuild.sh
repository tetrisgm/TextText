#!/bin/bash
# Autobuild daemon for Write. Watches main; whenever it advances with new
# release-worthy work, auto-bumps the version and runs the full ship (Mac
# build/notarize/install, web deploy, appcast). No prompts, ever. Runs via
# launchd (release/install-autobuild.sh). Design goals:
#   - Ship the LATEST automatically, every time there is something new.
#   - Never ask, never skip a release.
#   - Never waste a build: debounce bursts into ONE ship, only ship a fully
#     COMMITTED clean tree, and never re-ship an unchanged state or a release
#     commit (which would loop).
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/.npm-global/bin"
REPO="$HOME/dev/write"
POLL=20            # seconds between HEAD checks
DEBOUNCE=45        # seconds of commit quiescence before shipping a burst
LOG="$REPO/release/.autobuild.log"

cd "$REPO" || exit 1
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# A tree safe to ship: nothing staged, unstaged, or untracked. This is what keeps
# a half-finished edit or an uncommitted agent run from ever shipping.
clean() {
  git diff --quiet && git diff --cached --quiet \
    && [ -z "$(git ls-files --others --exclude-standard)" ]
}

# 0.90 -> 0.91 (bump the last numeric component of CFBundleShortVersionString).
next_version() {
  local v
  v=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' mac/Info.plist)
  echo "${v%.*}.$(( ${v##*.} + 1 ))"
}

last=$(git rev-parse HEAD)
log "autobuild started; watching main at $last"

while true; do
  sleep "$POLL"
  head=$(git rev-parse HEAD 2>/dev/null) || continue
  [ "$head" = "$last" ] && continue

  # Our own release-metadata commit: acknowledge it, never re-ship it (would loop).
  case "$(git log -1 --format=%s)" in
    "Release Write"*) last="$head"; continue ;;
  esac

  # Only ever ship a fully committed tree.
  if ! clean; then
    log "new commit $head but tree not clean; holding until committed"
    continue
  fi

  # Debounce: let a burst of commits settle so it becomes ONE ship.
  stable="$head"
  while true; do
    sleep "$DEBOUNCE"
    now=$(git rev-parse HEAD)
    [ "$now" = "$stable" ] && break
    stable="$now"
  done
  clean || { log "tree went dirty during debounce; holding"; continue; }

  ver=$(next_version)
  log "shipping $ver (HEAD $stable)"
  if ./release/ship.sh "$ver" >> "$LOG" 2>&1; then
    git add mac/Info.plist src/generated/app-release.ts 2>/dev/null
    git commit -q -m "Release Write $ver" 2>>"$LOG"
    git push origin main >> "$LOG" 2>&1
    log "shipped $ver and pushed"
  else
    log "ship $ver FAILED (exit $?). Left for the next commit to retry."
  fi
  last=$(git rev-parse HEAD)
done
