#!/usr/bin/env bash
# Assemble mac/build/TextText.app: the Swift binary + Sparkle.framework, signed
# inside-out (the partyparty recipe, minus the Helpers tree).
#
#   mac/scripts/build-app.sh                 -> auto-detects a Developer ID
#                                               Application identity, else ad-hoc
#   TEXTTEXT_SIGN_ID="Developer ID Application: ... (<TEAMID>)" mac/scripts/build-app.sh
#
# Identity/origin injection happens HERE, on the STAGED plist only; the
# committed mac/Info.plist keeps its neutral placeholders:
#   TEXTTEXT_BUNDLE_ID          -> CFBundleIdentifier
#   TEXTTEXT_PRODUCT_ORIGIN=https://TextText.app
#                            -> TextTextServerOrigin (where the app talks) AND
#                               SUFeedURL = <origin>/appcast.xml (where it looks
#                               for updates). Two keys, because a build without
#                               an updater still has a server.
#   TEXTTEXT_SPARKLE_PUBLIC_KEY -> SUPublicEDKey
set -euo pipefail
cd "$(dirname "$0")/.."
MAC="$(pwd)"
APP="$MAC/build/TextText.app"
# Two editions, two entitlement files, never mixed: the Store edition is
# sandboxed and carries no updater; the standalone edition is Developer ID with
# Sparkle. TEXTTEXT_STORE=1 selects the first.
STORE="${TEXTTEXT_STORE:-0}"
if [ "$STORE" = "1" ]; then
  ENT="$MAC/texttext-app-store.entitlements"
else
  ENT="$MAC/texttext.entitlements"
fi
PB=/usr/libexec/PlistBuddy

require_release_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Refusing: $name must be set to build TextText.app." >&2
    exit 1
  fi
}

require_release_env TEXTTEXT_BUNDLE_ID
require_release_env TEXTTEXT_PRODUCT_ORIGIN
if [ "${TEXTTEXT_STORE:-0}" != "1" ]; then
  require_release_env TEXTTEXT_SPARKLE_PUBLIC_KEY
fi

# Stable signing keeps macOS trust anchored across rebuilds. Prefer an
# explicit TEXTTEXT_SIGN_ID, else auto-detect a local Developer ID Application
# identity, else fall back to ad-hoc.
SIGN_ID="${TEXTTEXT_SIGN_ID:-}"
if [ -z "$SIGN_ID" ]; then
  if [ "$STORE" = "1" ]; then
    # A Store build is signed Apple Distribution; Developer ID is the other
    # lane's identity and Apple rejects a package signed with it.
    SIGN_ID="$(security find-identity -p codesigning -v 2>/dev/null | awk -F'"' '/Apple Distribution/{print $2; exit}')"
  else
    SIGN_ID="$(security find-identity -p codesigning -v 2>/dev/null | awk -F'"' '/Developer ID Application/{print $2; exit}')"
  fi
  [ -z "$SIGN_ID" ] && SIGN_ID="-"
fi

# macOS wants the group team-prefixed. A Store profile grants
# "<team>.*", so an unprefixed "group.x" is outside what the profile allows:
# codesign still signs it and the app then fails to spawn, which reads as a
# mysterious launch failure rather than the entitlement mismatch it is.
# Developer ID has shipped unprefixed for a while, so accept either shape and
# require the prefix only where it is actually enforced.
if [ -n "${TEXTTEXT_APP_GROUP:-}" ] \
  && ! [[ "$TEXTTEXT_APP_GROUP" =~ ^([A-Z0-9]{10}\.)?group\.[A-Za-z0-9.-]+$ ]]; then
  echo "Refusing: TEXTTEXT_APP_GROUP is not a valid application group: $TEXTTEXT_APP_GROUP" >&2
  exit 1
fi
# Derived here rather than at first use: a Store build has to prefix the app
# group with it, and the group is stamped into Info.plist further down.
#
# The profile is the authority, not the identity name. The parenthetical in
# "Apple Distribution: Name (52WM463HR2)" is the team, but in
# "Apple Development: Created via API (PNPRMWUDTD)" it is not, and prefixing an
# app group with that produces a group no profile grants and an app macOS
# refuses to spawn.
if [ "$STORE" = "1" ]; then
  TEAM_PROFILE="$MAC/profiles/TextText_App_${TEXTTEXT_STORE_PROFILE_SUFFIX:-AppStore}.provisionprofile"
else
  TEAM_PROFILE="$MAC/profiles/TextText_App_Developer_ID.provisionprofile"
fi
TEAM=""
if [ -f "$TEAM_PROFILE" ]; then
  TEAM="$(security cms -D -i "$TEAM_PROFILE" 2>/dev/null \
    | plutil -extract Entitlements.com\\.apple\\.developer\\.team-identifier raw -o - - 2>/dev/null || true)"
fi
if [ -z "$TEAM" ]; then
  TEAM="$(printf '%s' "$SIGN_ID" | sed -n 's/.*(\([A-Z0-9]\{8,\}\))$/\1/p')"
fi
if [ "$STORE" = "1" ] && [ -n "${TEXTTEXT_APP_GROUP:-}" ] \
  && ! [[ "$TEXTTEXT_APP_GROUP" =~ ^[A-Z0-9]{10}\.group\. ]]; then
  if [ -z "$TEAM" ]; then
    echo "Refusing: a Store build needs a team-prefixed app group and the team could not be read from: $SIGN_ID" >&2
    exit 1
  fi
  TEXTTEXT_APP_GROUP="$TEAM.$TEXTTEXT_APP_GROUP"
  export TEXTTEXT_APP_GROUP
  echo ">> Store edition: app group prefixed for the profile -> $TEXTTEXT_APP_GROUP"
fi

# A signed release with extension profiles but no group produces an appex that
# codesign accepts but File Provider cannot launch. Development ad-hoc builds
# may omit the group; a Developer ID build may not.
FP_PROFILE="$MAC/profiles/TextText_FileProvider_Developer_ID.provisionprofile"
if [ "$SIGN_ID" != "-" ] && [ -f "$FP_PROFILE" ] && [ -z "${TEXTTEXT_APP_GROUP:-}" ]; then
  echo "Refusing: TEXTTEXT_APP_GROUP must be set for a signed File Provider build." >&2
  exit 1
fi

echo ">> swift build (release)"
swift build -c release --triple arm64-apple-macosx14.0 --package-path "$MAC"
BIN="$(swift build -c release --triple arm64-apple-macosx14.0 \
  --package-path "$MAC" --show-bin-path)"

echo ">> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Frameworks"
# The product is TextTextApp; the bundle binary keeps the CFBundleExecutable
# name TextText.
cp "$BIN/TextTextApp" "$APP/Contents/MacOS/TextText"
# The agent CLI ships beside the app binary so it is present wherever TextText
# is installed, and so one implementation owns the .textpack format.
# The CLI lives in Helpers, not MacOS. "TextText" and "texttext" are the same
# path on a stock case-insensitive Mac volume, so shipping both in MacOS meant
# the CLI overwrote the app and the bundle's main executable WAS the CLI - it
# printed usage and exited instead of opening a window. Latent until the
# product was renamed from Write to TextText, which is when the two names
# collided.
# The CLI ships in the standalone edition only. The Store rules require every
# nested executable to be sandboxed, and a sandboxed CLI is pointless anyway:
# it would run in its own container rather than the app's, and the symlink that
# puts it on PATH lands inside the container where no shell will find it. So the
# Store edition would be shipping an executable that cannot work, at the cost of
# an upload rejection (ITMS-90296) if it were signed unsandboxed.
if [ "$STORE" != "1" ]; then
  mkdir -p "$APP/Contents/Helpers"
  cp "$BIN/texttext" "$APP/Contents/Helpers/texttext"
fi
cp "$MAC/Info.plist" "$APP/Contents/Info.plist"
cp "$MAC/PrivacyInfo.xcprivacy" "$APP/Contents/Resources/PrivacyInfo.xcprivacy"
if [ -f "$MAC/AppIcon.icns" ]; then
  cp "$MAC/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
else
  echo "   (no AppIcon.icns yet; run mac/scripts/make-icon.sh)"
fi
if [ -n "${TEXTTEXT_BUILD_ATTESTATION:-}" ]; then
  [ -f "$TEXTTEXT_BUILD_ATTESTATION" ] || {
    echo "TEXTTEXT_BUILD_ATTESTATION does not exist: $TEXTTEXT_BUILD_ATTESTATION" >&2
    exit 1
  }
  cp "$TEXTTEXT_BUILD_ATTESTATION" \
    "$APP/Contents/Resources/AppHealthBuildAttestation.json"
fi

echo ">> App Intents metadata (xcodebuild const-values pass)"
# SwiftPM cannot emit the .swiftconstvalues the App Intents metadata
# processor requires, so a parallel xcodebuild pass produces them; the shipped
# binary stays the SwiftPM one above. The derived-data cache makes this fast
# after the first release. Metadata failure fails the build: the intents
# would silently be invisible to Shortcuts otherwise.
# Scheme name follows the SwiftPM target, which is TextTextApp: the app target
# and the `texttext` CLI product cannot both be called TextText on a
# case-insensitive volume. A stale name here fails only in the release path,
# where the metadata pass runs.
xcodebuild build -scheme TextTextApp -destination 'platform=macOS,arch=arm64' \
  -configuration Release -derivedDataPath "$MAC/.build/xcode-dd" \
  SWIFT_EMIT_CONST_VALUES=YES CODE_SIGNING_ALLOWED=NO -quiet
CONSTVALS="$MAC/build/appintents-constvals.txt"
find "$MAC/.build/xcode-dd" -name '*.swiftconstvalues' | sort > "$CONSTVALS"
[ -s "$CONSTVALS" ] || { echo "xcodebuild emitted no .swiftconstvalues" >&2; exit 1; }
APPINTENTS_SWIFT_CONST_VALS_LIST="$CONSTVALS" "$MAC/scripts/appintents-metadata.sh" \
  "$APP/Contents/MacOS/TextText" "$APP"
rm -f "$CONSTVALS"

STAGED="$APP/Contents/Info.plist"
"$PB" -c "Set :CFBundleIdentifier $TEXTTEXT_BUNDLE_ID" "$STAGED"

# Build provenance. Xcode stamps these into every bundle it produces; this app
# is assembled by hand from a SwiftPM build, so nothing stamps them and the
# bundle arrives at App Store Connect looking like it was built by no known
# toolchain. Read them from the active toolchain rather than hardcoding, so they
# describe the build that actually happened.
stamp() { # $1=key $2=type $3=value
  [ -z "$3" ] && return 0
  "$PB" -c "Set :$1 $3" "$STAGED" 2>/dev/null || "$PB" -c "Add :$1 $2 $3" "$STAGED"
}
SDK_VERSION="$(xcrun --sdk macosx --show-sdk-version 2>/dev/null || true)"
XCODE_VERSION="$(xcodebuild -version 2>/dev/null | sed -n 's/^Xcode //p' | head -1)"
# Xcode's own encoding: 26.6 becomes 2660, major*100 + minor*10 + patch.
DT_XCODE=""
if [ -n "$XCODE_VERSION" ]; then
  DT_XCODE="$(printf '%s' "$XCODE_VERSION" | awk -F. '{printf "%d%d%d", $1, ($2==""?0:$2), ($3==""?0:$3)}')"
fi
stamp DTPlatformName string "macosx"
stamp DTPlatformVersion string "$SDK_VERSION"
stamp DTSDKName string "macosx$SDK_VERSION"
stamp DTSDKBuild string "$(xcrun --sdk macosx --show-sdk-build-version 2>/dev/null || true)"
stamp DTXcode string "$DT_XCODE"
stamp DTXcodeBuild string "$(xcodebuild -version 2>/dev/null | sed -n 's/^Build version //p' | head -1)"
stamp DTCompiler string "com.apple.compilers.llvm.clang.1_0"
stamp BuildMachineOSBuild string "$(sw_vers -buildVersion 2>/dev/null || true)"
"$PB" -c "Delete :CFBundleSupportedPlatforms" "$STAGED" 2>/dev/null || true
"$PB" -c "Add :CFBundleSupportedPlatforms array" "$STAGED"
"$PB" -c "Add :CFBundleSupportedPlatforms:0 string MacOSX" "$STAGED"
# The server origin is its own key. It used to be inferred from SUFeedURL,
# which silently tied "where this app talks" to "does this build self-update":
# a bundle without a feed fell through to http://localhost:3000. Any build that
# drops Sparkle - a Mac App Store build, for instance - would have shipped
# pointing at localhost.
"$PB" -c "Add :TextTextServerOrigin string ${TEXTTEXT_PRODUCT_ORIGIN%/}" "$STAGED" 2>/dev/null \
  || "$PB" -c "Set :TextTextServerOrigin ${TEXTTEXT_PRODUCT_ORIGIN%/}" "$STAGED"
if [ "$STORE" = "1" ]; then
  # No updater keys in a Store bundle: the store does the updating, and their
  # presence alone invites a rejection.
  for k in SUFeedURL SUPublicEDKey SUAutomaticallyUpdate SUEnableAutomaticChecks SUScheduledCheckInterval; do
    "$PB" -c "Delete :$k" "$STAGED" 2>/dev/null || true
  done
else
  "$PB" -c "Set :SUFeedURL ${TEXTTEXT_PRODUCT_ORIGIN%/}/appcast.xml" "$STAGED"
  "$PB" -c "Set :SUPublicEDKey $TEXTTEXT_SPARKLE_PUBLIC_KEY" "$STAGED"
fi
# The app locates the share inbox by this group id. Sandboxed, it asks the
# system and gets the one true container; unsandboxed, it tries the two paths
# the group can live at. Empty leaves the TEXTTEXT_APP_GROUP placeholder, which
# the resolver ignores.
if [ -n "${TEXTTEXT_APP_GROUP:-}" ]; then
  "$PB" -c "Set :TextTextAppGroupIdentifier $TEXTTEXT_APP_GROUP" "$STAGED" 2>/dev/null \
    || "$PB" -c "Add :TextTextAppGroupIdentifier string $TEXTTEXT_APP_GROUP" "$STAGED"
fi
# The app and the File Provider extension share a keychain access group to hand
# the sync token across: the app cannot write the app-group container (that write
# is sandbox-gated), but the keychain is not. The group is
# <TeamID>.app.texttext.fp; stamp the resolved value so both bundles read
# the same string at runtime (Info.plist TextTextKeychainAccessGroup).
if [ -n "$TEAM" ]; then
  KC_GROUP="$TEAM.app.texttext.fp"
  "$PB" -c "Set :TextTextKeychainAccessGroup $KC_GROUP" "$STAGED" 2>/dev/null \
    || "$PB" -c "Add :TextTextKeychainAccessGroup string $KC_GROUP" "$STAGED"
fi
if [ -n "${APP_VERSION:-}" ]; then
  [[ "$APP_VERSION" =~ ^[0-9]+(\.[0-9]+)+$ ]] || {
    echo "APP_VERSION must be dotted numeric, got: $APP_VERSION" >&2
    exit 1
  }
  "$PB" -c "Set :CFBundleShortVersionString $APP_VERSION" "$STAGED"
fi
if [ -n "${APP_BUILD_NUMBER:-}" ]; then
  [[ "$APP_BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]] || {
    echo "APP_BUILD_NUMBER must be a positive integer, got: $APP_BUILD_NUMBER" >&2
    exit 1
  }
  "$PB" -c "Set :CFBundleVersion $APP_BUILD_NUMBER" "$STAGED"
fi

# Sparkle framework (auto-update): embed + make it discoverable via rpath.
# Never in the Store edition - App Review rejects a bundle that carries a
# self-updater whether or not the code runs, and Sparkle's Autoupdate and
# Installer.xpc are not sandboxed, which the store also forbids.
if [ "$STORE" = "1" ]; then
  echo ">> Store edition: no Sparkle"
elif [ -d "$BIN/Sparkle.framework" ]; then
  cp -R "$BIN/Sparkle.framework" "$APP/Contents/Frameworks/Sparkle.framework"
  install_name_tool -add_rpath "@executable_path/../Frameworks" "$APP/Contents/MacOS/TextText" 2>/dev/null || true
else
  echo "!! Sparkle.framework not found in $BIN" >&2
  exit 1
fi
chmod +x "$APP/Contents/MacOS/TextText"
[ -f "$APP/Contents/Helpers/texttext" ] && chmod +x "$APP/Contents/Helpers/texttext"

codesign_one() { # $1=path  $2=entitlements (optional)
  local path="$1" ent="${2:-}"
  local args=(--force)
  if [ "$SIGN_ID" = "-" ]; then
    args+=(--sign -)
  else
    # Hardened runtime + secure timestamp: both required for notarization.
    args+=(--options runtime --timestamp --sign "$SIGN_ID")
  fi
  [ -n "$ent" ] && args+=(--entitlements "$ent")
  codesign "${args[@]}" "$path"
}

# The main app carries the app-group entitlement so it can write the File
# Provider credential handoff into the shared container the sandboxed extension
# reads. That is a restricted entitlement: it needs an embedded Developer ID
# provisioning profile authorizing the group. With the profile present (and a
# real identity + TEXTTEXT_APP_GROUP), sign with the app-group entitlement; without
# it, sign with empty entitlements so dev/ad-hoc builds still succeed (the File
# Provider just cannot authenticate).
# Each edition embeds its own profile. A Developer ID profile in a Store build
# (or the reverse) is a signing failure at best and a rejected binary at worst.
if [ "$STORE" = "1" ]; then
  APP_PROFILE="$MAC/profiles/TextText_App_${TEXTTEXT_STORE_PROFILE_SUFFIX:-AppStore}.provisionprofile"
else
  APP_PROFILE="$MAC/profiles/TextText_App_Developer_ID.provisionprofile"
fi
MAIN_ENT="$(mktemp -t texttext-main-ent)"
if [ -f "$APP_PROFILE" ] && [ "$SIGN_ID" != "-" ] && [ -n "${TEXTTEXT_APP_GROUP:-}" ]; then
  cp "$APP_PROFILE" "$APP/Contents/embedded.provisionprofile"
  # codesign does NOT expand $(AppIdentifierPrefix); substitute the resolved
  # team-prefixed keychain group (computed above) just like the app group.
  /usr/bin/sed \
    -e "s/TEXTTEXT_APP_GROUP/${TEXTTEXT_APP_GROUP}/g" \
    -e "s/TEXTTEXT_KEYCHAIN_GROUP/${KC_GROUP:-}/g" \
    "$ENT" > "$MAIN_ENT"
  # TestFlight refuses a bundle whose signature omits the application
  # identifier while its embedded profile carries one (error 90886): the two
  # must agree. It cannot live in the checked-in entitlements because it is
  # team-prefixed, so it is injected here from the resolved team, exactly like
  # the app group and the keychain group above.
  if [ "$STORE" = "1" ] && [ -n "${TEAM:-}" ]; then
    "$PB" -c "Add :com.apple.application-identifier string $TEAM.$TEXTTEXT_BUNDLE_ID" "$MAIN_ENT" 2>/dev/null \
      || "$PB" -c "Set :com.apple.application-identifier $TEAM.$TEXTTEXT_BUNDLE_ID" "$MAIN_ENT"
    "$PB" -c "Add :com.apple.developer.team-identifier string $TEAM" "$MAIN_ENT" 2>/dev/null \
      || "$PB" -c "Set :com.apple.developer.team-identifier $TEAM" "$MAIN_ENT"
  fi
  echo ">> main app: app-group + keychain entitlement + embedded profile"
elif [ "$STORE" = "1" ]; then
  # The Store edition must be sandboxed even when no profile is around, or a
  # local test build silently proves nothing: the whole point of this edition
  # is that it runs under the sandbox. The app group and keychain group ARE
  # restricted and need a profile, so they are dropped rather than faked; the
  # File Provider handoff simply cannot authenticate in that state.
  cp "$ENT" "$MAIN_ENT"
  "$PB" -c "Delete :com.apple.security.application-groups" "$MAIN_ENT" 2>/dev/null || true
  "$PB" -c "Delete :keychain-access-groups" "$MAIN_ENT" 2>/dev/null || true
  echo ">> main app: sandboxed, no profile so no app-group or keychain group"
else
  printf '%s\n' \
    '<?xml version="1.0" encoding="UTF-8"?>' \
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
    '<plist version="1.0"><dict/></plist>' > "$MAIN_ENT"
  echo ">> main app: no app-group profile; signing without the app-group entitlement"
fi

echo ">> codesigning inside-out ($SIGN_ID)"
SPK="$APP/Contents/Frameworks/Sparkle.framework"
if [ "$STORE" = "1" ]; then
  : # Store edition ships no Sparkle, so there is nothing to sign here.
elif [ "$SIGN_ID" = "-" ]; then
  codesign --force --deep --sign - "$SPK"   # ad-hoc: deep is fine for local dev
else
  # Developer ID: Sparkle's nested helpers first, then the framework. Never
  # use --deep with a real identity.
  V="$SPK/Versions/B"
  for n in "XPCServices/Installer.xpc" "XPCServices/Downloader.xpc" "Autoupdate" "Updater.app"; do
    [ -e "$V/$n" ] && codesign_one "$V/$n"
  done
  codesign_one "$SPK"
fi
[ -f "$APP/Contents/Helpers/texttext" ] && codesign_one "$APP/Contents/Helpers/texttext"
codesign_one "$APP/Contents/MacOS/TextText" "$MAIN_ENT"
# Extensions are assembled and signed here, inside-out, so the main app's
# signature (next line) seals them. No-op unless mac/profiles/ holds the
# provisioning profiles and a real Developer ID identity is in use.
"$MAC/scripts/embed-extensions.sh" "$APP" "$SIGN_ID" "${TEXTTEXT_APP_GROUP:-}" \
  "$TEXTTEXT_BUNDLE_ID" \
  "$("$PB" -c 'Print :CFBundleShortVersionString' "$STAGED")" \
  "$("$PB" -c 'Print :CFBundleVersion' "$STAGED")"
codesign_one "$APP" "$MAIN_ENT"
rm -f "$MAIN_ENT"

echo ">> verify"
codesign --verify --strict --verbose=2 "$APP"
if [ "$SIGN_ID" = "-" ]; then
  "$MAC/scripts/verify-apple-silicon-app.sh" "$APP"
else
  "$MAC/scripts/verify-apple-silicon-app.sh" "$APP" --require-extensions
fi
echo ">> built $APP"
