#!/usr/bin/env bash
# Replace every local TextText installation with one verified canonical bundle.
# The swap is recoverable until the new app launches and writes a passing health
# report for its exact version and build. This script never publishes anything.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="${TEXTTEXT_APPLICATIONS_APP:-/Applications/TextText.app}"
SOURCE="${TEXTTEXT_SOURCE_APP:-$ROOT/mac/build/TextText.app}"
PB="${TEXTTEXT_PLIST_BUDDY:-/usr/libexec/PlistBuddy}"
TRASH="${TEXTTEXT_TRASH_DIR:-$HOME/.Trash}"
EXPECTED_VERSION="${TEXTTEXT_EXPECTED_VERSION:-}"
EXPECTED_BUILD="${TEXTTEXT_EXPECTED_BUILD:-}"
REQUIRE_RUNTIME_HEALTH="${TEXTTEXT_REQUIRE_RUNTIME_HEALTH:-1}"
HEALTH_WAIT_SECONDS="${TEXTTEXT_HEALTH_WAIT_SECONDS:-120}"
HEALTH_REPORT="${TEXTTEXT_RUNTIME_HEALTH_PATH:-$HOME/Library/Application Support/TextText/health/latest.json}"
SKIP_BINARY_VERIFICATION="${TEXTTEXT_SKIP_BINARY_VERIFICATION:-0}"
SKIP_LAUNCH="${TEXTTEXT_SKIP_LAUNCH:-0}"
PARENT="$(dirname "$APP")"
STAGE="$PARENT/.TextText.app.new.$$"
OLD="$PARENT/.TextText.app.previous.$$"
FAILED="$PARENT/.TextText.app.failed.$$"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
BUNDLE_ID="app.texttext.mac"

if [[ "$APP" == "/Applications/TextText.app" ]] && \
  { [[ "$SKIP_BINARY_VERIFICATION" == "1" ]] || [[ "$SKIP_LAUNCH" == "1" ]] || \
    [[ "$REQUIRE_RUNTIME_HEALTH" != "1" ]]; }; then
  echo "Refusing test-only installer overrides for /Applications/TextText.app." >&2
  exit 1
fi
if [[ "$REQUIRE_RUNTIME_HEALTH" != "0" && "$REQUIRE_RUNTIME_HEALTH" != "1" ]]; then
  echo "TEXTTEXT_REQUIRE_RUNTIME_HEALTH must be 0 or 1." >&2
  exit 1
fi
if ! [[ "$HEALTH_WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "TEXTTEXT_HEALTH_WAIT_SECONDS must be a positive integer." >&2
  exit 1
fi

plist_value() {
  "$PB" -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null || true
}

bundle_id() { plist_value "$1" CFBundleIdentifier; }
app_version() { plist_value "$1" CFBundleShortVersionString; }
app_build() { plist_value "$1" CFBundleVersion; }

[[ -d "$SOURCE" ]] || { echo "Missing built app: $SOURCE" >&2; exit 1; }
[[ "$(bundle_id "$SOURCE")" == "$BUNDLE_ID" ]] || {
  echo "Refusing to install bundle id '$(bundle_id "$SOURCE")'; expected $BUNDLE_ID." >&2
  exit 1
}
SOURCE_VERSION="$(app_version "$SOURCE")"
SOURCE_BUILD="$(app_build "$SOURCE")"
[[ -z "$EXPECTED_VERSION" || "$SOURCE_VERSION" == "$EXPECTED_VERSION" ]] || {
  echo "Built app version is $SOURCE_VERSION, expected $EXPECTED_VERSION." >&2
  exit 1
}
[[ -z "$EXPECTED_BUILD" || "$SOURCE_BUILD" == "$EXPECTED_BUILD" ]] || {
  echo "Built app build is $SOURCE_BUILD, expected $EXPECTED_BUILD." >&2
  exit 1
}

if [[ "$SKIP_BINARY_VERIFICATION" != "1" ]]; then
  codesign --verify --strict --verbose=2 "$SOURCE"
  "$ROOT/mac/scripts/verify-apple-silicon-app.sh" "$SOURCE" --require-extensions
fi

mkdir -p "$PARENT"
rm -rf "$STAGE" "$OLD" "$FAILED"
ditto "$SOURCE" "$STAGE"

shopt -s nullglob
candidate_apps=()
add_candidate() {
  local candidate="$1" existing
  [[ -e "$candidate" ]] || return 0
  for existing in "${candidate_apps[@]-}"; do
    [[ "$existing" != "$candidate" ]] || return 0
  done
  candidate_apps+=("$candidate")
}

add_candidate "$APP"
for candidate in "$PARENT"/TextText\ [0-9]*.app; do add_candidate "$candidate"; done

# TestFlight and standalone installs have both appeared under ~/Applications.
# Sweep only bundles that claim TextText's exact identifier; unrelated apps are
# never moved just because their filename happens to match.
if [[ "$PARENT" != "$HOME/Applications" && -d "$HOME/Applications" ]]; then
  add_candidate "$HOME/Applications/TextText.app"
  for candidate in "$HOME/Applications"/TextText\ [0-9]*.app; do add_candidate "$candidate"; done
fi
if [[ -n "${TEXTTEXT_ADDITIONAL_APPLICATIONS_DIRS:-}" ]]; then
  IFS=':' read -r -a additional_dirs <<< "$TEXTTEXT_ADDITIONAL_APPLICATIONS_DIRS"
  for directory in "${additional_dirs[@]}"; do
    [[ -d "$directory" ]] || continue
    add_candidate "$directory/TextText.app"
    for candidate in "$directory"/TextText\ [0-9]*.app; do add_candidate "$candidate"; done
  done
fi

verified_apps=()
for candidate in "${candidate_apps[@]-}"; do
  candidate_id="$(bundle_id "$candidate")"
  if [[ "$candidate" == "$APP" && "$candidate_id" != "$BUNDLE_ID" ]]; then
    rm -rf "$STAGE"
    echo "Refusing: $APP is not the TextText bundle ($BUNDLE_ID)." >&2
    exit 1
  fi
  [[ "$candidate_id" == "$BUNDLE_ID" ]] || continue
  verified_apps+=("$candidate")
done

app_pids() {
  local candidate executable
  for candidate in "$@"; do
    executable="$candidate/Contents/MacOS/TextText"
    ps ax -o pid=,command= | awk -v executable="$executable" '$2 == executable { print $1 }'
  done
}

apps_are_running() { [[ -n "$(app_pids "$@")" ]]; }

stop_apps() {
  local pids attempt
  [[ "$SKIP_LAUNCH" != "1" ]] || return 0
  apps_are_running "$@" || return 0
  osascript -e 'tell application id "app.texttext.mac" to quit' </dev/null >/dev/null 2>&1 || true
  for attempt in {1..20}; do
    apps_are_running "$@" || return 0
    sleep 0.25
  done
  pids="$(app_pids "$@")"
  [[ -z "$pids" ]] || kill -TERM $pids 2>/dev/null || true
  for attempt in {1..20}; do
    apps_are_running "$@" || return 0
    sleep 0.25
  done
  return 1
}

launch_canonical() {
  local attempt settle stable
  [[ "$SKIP_LAUNCH" != "1" ]] || return 0
  "$LSREGISTER" -f "$APP" </dev/null >/dev/null 2>&1 || true
  for attempt in {1..5}; do
    if open -g "$APP" </dev/null >/dev/null 2>&1; then
      for settle in {1..20}; do
        if apps_are_running "$APP"; then
          for stable in {1..8}; do
            sleep 0.25
            apps_are_running "$APP" || break
          done
          apps_are_running "$APP" && return 0
        fi
        sleep 0.25
      done
    fi
    sleep "$attempt"
  done
  return 1
}

trash_destination() {
  local candidate="$1" label="$2" version build destination
  version="$(app_version "$candidate")"
  build="$(app_build "$candidate")"
  version="${version:-unknown}"
  build="${build:-unknown}"
  destination="$TRASH/TextText $version ($build) $label.app"
  if [[ -e "$destination" ]]; then
    destination="$TRASH/TextText $version ($build) $label $(date +%Y%m%d-%H%M%S)-$$.app"
  fi
  printf '%s\n' "$destination"
}

duplicate_originals=()
duplicate_staged=()
cleanup_sources=()
cleanup_destinations=()
INSTALL_WAS_RUNNING=0
SWAP_ACTIVE=0
HAD_CANONICAL=0
if [[ "$SKIP_LAUNCH" != "1" ]] && apps_are_running "${verified_apps[@]-}"; then
  INSTALL_WAS_RUNNING=1
fi

rollback() {
  local index rollback_incomplete=0
  stop_apps "$APP" || true
  for (( index=${#cleanup_sources[@]}-1; index>=0; index-- )); do
    if [[ -e "${cleanup_destinations[$index]}" ]] && \
      ! mv "${cleanup_destinations[$index]}" "${cleanup_sources[$index]}"; then
      echo "Rollback could not restore ${cleanup_sources[$index]}; its recoverable copy remains at ${cleanup_destinations[$index]}." >&2
      rollback_incomplete=1
    fi
  done
  if [[ "$HAD_CANONICAL" == "0" || -e "$OLD" ]]; then
    rm -rf "$FAILED"
    [[ ! -e "$APP" ]] || mv "$APP" "$FAILED"
    if [[ -e "$OLD" ]] && ! mv "$OLD" "$APP"; then
      echo "Rollback could not restore the previous canonical app; keeping the new app recoverable." >&2
      rollback_incomplete=1
      [[ -e "$APP" || ! -e "$FAILED" ]] || mv "$FAILED" "$APP" || true
    fi
  else
    # Never remove the only runnable canonical app merely because Trash would
    # not give the previous bundle back. The old bundle remains recoverable at
    # the destination printed above and the failed installation stays in place.
    echo "Rollback left the new canonical app in place because the previous bundle could not be restored." >&2
    rollback_incomplete=1
  fi
  for (( index=${#duplicate_originals[@]}-1; index>=0; index-- )); do
    [[ ! -e "${duplicate_staged[$index]}" ]] || \
      mv "${duplicate_staged[$index]}" "${duplicate_originals[$index]}" || true
  done
  if [[ "$INSTALL_WAS_RUNNING" == "1" && -e "$APP" ]]; then
    launch_canonical || true
  fi
  if [[ "$rollback_incomplete" == "0" ]]; then
    rm -rf "$FAILED" "$STAGE" "$OLD"
  else
    rm -rf "$STAGE"
  fi
}

fail_install() {
  echo "$1" >&2
  if [[ "$SWAP_ACTIVE" == "1" ]]; then
    rollback
    SWAP_ACTIVE=0
  else
    rm -rf "$STAGE"
  fi
  exit 1
}

abort_install() {
  local status=$?
  trap - EXIT INT TERM HUP
  if [[ "$SWAP_ACTIVE" == "1" ]]; then
    rollback
    [[ "$status" != "0" ]] || status=1
  fi
  rm -rf "$STAGE"
  exit "$status"
}
trap abort_install EXIT INT TERM HUP

if ! stop_apps "${verified_apps[@]-}"; then
  rm -rf "$STAGE"
  echo "TextText did not quit. Nothing was replaced." >&2
  exit 1
fi

SWAP_ACTIVE=1
if [[ -e "$APP" ]]; then
  HAD_CANONICAL=1
  mv "$APP" "$OLD"
fi
duplicate_index=0
for candidate in "${verified_apps[@]-}"; do
  [[ "$candidate" != "$APP" ]] || continue
  duplicate_index=$((duplicate_index + 1))
  duplicate_hold="$(dirname "$candidate")/.TextText.duplicate.$$.${duplicate_index}.app"
  rm -rf "$duplicate_hold"
  if ! mv "$candidate" "$duplicate_hold"; then
    fail_install "Could not stage duplicate TextText bundle: $candidate"
  fi
  duplicate_originals+=("$candidate")
  duplicate_staged+=("$duplicate_hold")
done

mv "$STAGE" "$APP" || fail_install "Could not put the new TextText bundle at $APP."

[[ "$(bundle_id "$APP")" == "$BUNDLE_ID" ]] || fail_install "Installed bundle identifier changed during the swap."
[[ "$(app_version "$APP")" == "$SOURCE_VERSION" ]] || fail_install "Installed app version does not match the verified source."
[[ "$(app_build "$APP")" == "$SOURCE_BUILD" ]] || fail_install "Installed app build does not match the verified source."
if [[ "$SKIP_BINARY_VERIFICATION" != "1" ]]; then
  codesign --verify --strict --verbose=2 "$APP" || fail_install "Installed TextText failed signature verification."
  "$ROOT/mac/scripts/verify-apple-silicon-app.sh" "$APP" --require-extensions || \
    fail_install "Installed TextText failed Apple silicon verification."
fi

HEALTH_NOT_BEFORE="$(date +%s)"
launch_canonical || fail_install "The newly installed TextText app did not stay running."

if [[ "$SKIP_LAUNCH" != "1" ]]; then
  running_count="$(app_pids "$APP" | awk 'NF { count += 1 } END { print count + 0 }')"
  [[ "$running_count" == "1" ]] || fail_install "Expected one TextText process, found $running_count."
fi

if [[ "$REQUIRE_RUNTIME_HEALTH" == "1" ]]; then
  health_version=""
  health_build=""
  health_status=""
  health_fresh="0"
  for (( attempt=1; attempt<=HEALTH_WAIT_SECONDS; attempt++ )); do
    if [[ -f "$HEALTH_REPORT" ]]; then
      IFS=$'\t' read -r health_version health_build health_status health_fresh < <(
        python3 -c 'import datetime,json,sys
d=json.load(open(sys.argv[1], encoding="utf-8")); raw=d.get("generatedAt", "")
try: fresh=int(datetime.datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()) >= int(sys.argv[2])
except (TypeError, ValueError): fresh=False
print(d.get("appVersion", ""), d.get("buildNumber", ""), d.get("status", ""), int(fresh), sep="\t")' \
          "$HEALTH_REPORT" "$HEALTH_NOT_BEFORE" 2>/dev/null || printf '\t\t\t0\n'
      )
    fi
    if [[ "$health_version" == "$SOURCE_VERSION" && "$health_build" == "$SOURCE_BUILD" && \
      "$health_status" == "pass" && "$health_fresh" == "1" ]]; then
      break
    fi
    sleep 1
  done
  if [[ "$health_version" != "$SOURCE_VERSION" || "$health_build" != "$SOURCE_BUILD" || \
    "$health_status" != "pass" || "$health_fresh" != "1" ]]; then
    health_detail="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1], encoding="utf-8")); print(", ".join(c.get("id", "?") for c in d.get("checks", []) if c.get("status") != "pass"))' "$HEALTH_REPORT" 2>/dev/null || true)"
    fail_install "TextText runtime health did not pass for $SOURCE_VERSION ($SOURCE_BUILD). Status: ${health_status:-missing}. Checks: ${health_detail:-unavailable}."
  fi
  echo "   runtime health: pass"
fi

# The new app is now proven. Only now move recoverable prior bundles to Trash.
mkdir -p "$TRASH"
cleanup_failure() {
  fail_install "$1"
}
if [[ -e "$OLD" ]]; then
  old_destination="$(trash_destination "$OLD" "previous")"
  cleanup_sources+=("$OLD")
  cleanup_destinations+=("$old_destination")
  mv "$OLD" "$old_destination" || cleanup_failure "Could not move the previous TextText bundle to Trash."
fi
for (( index=0; index<${#duplicate_staged[@]}; index++ )); do
  duplicate_destination="$(trash_destination "${duplicate_staged[$index]}" "previous duplicate")"
  cleanup_sources+=("${duplicate_staged[$index]}")
  cleanup_destinations+=("$duplicate_destination")
  mv "${duplicate_staged[$index]}" "$duplicate_destination" || \
    cleanup_failure "Could not move a duplicate TextText bundle to Trash."
done

# Verify no second bundle with the product identifier remains at a known app
# location. An unrelated bundle with the same filename is ignored.
remaining=0
verification_candidates=("$APP")
for candidate in "$PARENT"/TextText\ [0-9]*.app; do verification_candidates+=("$candidate"); done
if [[ "$PARENT" != "$HOME/Applications" && -d "$HOME/Applications" ]]; then
  verification_candidates+=("$HOME/Applications/TextText.app")
  for candidate in "$HOME/Applications"/TextText\ [0-9]*.app; do verification_candidates+=("$candidate"); done
fi
if [[ -n "${TEXTTEXT_ADDITIONAL_APPLICATIONS_DIRS:-}" ]]; then
  for directory in "${additional_dirs[@]}"; do
    [[ -d "$directory" ]] || continue
    verification_candidates+=("$directory/TextText.app")
    for candidate in "$directory"/TextText\ [0-9]*.app; do verification_candidates+=("$candidate"); done
  done
fi
for candidate in "${verification_candidates[@]}"; do
  [[ -e "$candidate" ]] || continue
  [[ "$(bundle_id "$candidate")" == "$BUNDLE_ID" ]] || continue
  remaining=$((remaining + 1))
done
[[ "$remaining" == "1" ]] || cleanup_failure "Expected one installed TextText bundle, found $remaining."

"$LSREGISTER" -f "$APP" </dev/null >/dev/null 2>&1 || true
SWAP_ACTIVE=0
echo "Installed, launched, and verified one canonical copy: $APP ($SOURCE_VERSION build $SOURCE_BUILD)"
