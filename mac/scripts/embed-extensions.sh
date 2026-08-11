#!/usr/bin/env bash
# Build, embed, and sign the Share, Quick Look, and File Provider extensions into an
# already-assembled TextText.app, inside-out, before the main app is signed.
#
#   mac/scripts/embed-extensions.sh <app-bundle> <sign-id> <app-group> <bundle-id> <version> <build>
#
# Extensions are sandboxed and use an app group, which is a restricted
# entitlement: each .appex must embed a Developer ID provisioning profile that
# authorizes the group. Drop the two profiles in mac/profiles/ (see
# docs/apple-workspace.md). If they are absent this script is a no-op, so
# builds without them still succeed (the extensions just are not embedded).
set -euo pipefail
cd "$(dirname "$0")/.."
MAC="$(pwd)"
PB=/usr/libexec/PlistBuddy

APP="$1"; SIGN_ID="$2"; APP_GROUP="$3"; BUNDLE_ID="$4"; VERSION="$5"; BUILD="$6"

# The File Provider extension shares a keychain access group with the app to read
# the sync token (<TeamID>.app.texttext.fp). Resolve the team from the
# signing identity so the Info.plist carries the same string the app does.
TEAM="$(printf '%s' "$SIGN_ID" | sed -n 's/.*(\([A-Z0-9]\{8,\}\))$/\1/p')"
KEYCHAIN_GROUP="${TEAM:+$TEAM.app.texttext.fp}"

# Developer ID by default; a Store build passes AppStore (upload) or Dev (the
# same sandboxed shape signed to run on this Mac) via the suffix.
PROFILE_SUFFIX="${TEXTTEXT_STORE_PROFILE_SUFFIX:-Developer_ID}"
SHARE_PROFILE="$MAC/profiles/TextText_Share_${PROFILE_SUFFIX}.provisionprofile"
QL_PROFILE="$MAC/profiles/TextText_QuickLook_${PROFILE_SUFFIX}.provisionprofile"
FP_PROFILE="$MAC/profiles/TextText_FileProvider_${PROFILE_SUFFIX}.provisionprofile"
if [ ! -f "$SHARE_PROFILE" ] || [ ! -f "$QL_PROFILE" ] || [ ! -f "$FP_PROFILE" ]; then
  echo ">> extensions: no provisioning profiles in mac/profiles; skipping embed"
  exit 0
fi
if [ "$SIGN_ID" = "-" ]; then
  echo ">> extensions: app-group entitlements need a real Developer ID identity; skipping embed (ad-hoc build)"
  exit 0
fi
if [ -z "$APP_GROUP" ]; then
  echo "Refusing: a signed extension build requires a non-empty app group." >&2
  exit 1
fi
# Either shape: "group.x" (Developer ID) or "<team>.group.x" (Store, where the
# provisioning profile only grants "<team>.*").
if ! [[ "$APP_GROUP" =~ ^([A-Z0-9]{10}\.)?group\.[A-Za-z0-9.-]+$ ]]; then
  echo "Refusing: invalid extension app group: $APP_GROUP" >&2
  exit 1
fi

BIN="$(swift build -c release --package-path "$MAC" --show-bin-path)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
TARGET_TRIPLE="arm64-apple-macosx14.0"
PLUGINS="$APP/Contents/PlugIns"
mkdir -p "$PLUGINS"

# TextTextShareCore (Foundation only) is the sole library dependency of the Share
# and Quick Look extensions; collect its release objects once.
CORE_OBJS=()
while IFS= read -r f; do CORE_OBJS+=("$f"); done < <(find "$BIN/TextTextShareCore.build" -name '*.o')
[ "${#CORE_OBJS[@]}" -gt 0 ] || { echo "no TextTextShareCore objects; run swift build -c release first" >&2; exit 1; }

# The File Provider extension depends instead on the FP Kit + Bridge and
# ZIPFoundation (not TextTextShareCore); collect their release objects for its
# dedicated link. The
# extension's own two sources are compiled fresh by embed_appex below, so do NOT
# also link TextTextFileProviderExtensionCore objects (that would double symbols).
FP_OBJS=()
while IFS= read -r f; do FP_OBJS+=("$f"); done < <(find \
  "$BIN/TextTextFileProviderKit.build" "$BIN/TextTextFileProviderBridge.build" \
  "$BIN/ZIPFoundation.build" -name '*.o')
[ "${#FP_OBJS[@]}" -gt 0 ] || { echo "no File Provider objects; run swift build -c release first" >&2; exit 1; }

# $1=appex-name $2=source-dir $3=principal-suffix $4=profile $5=entitlements-template
#   plus extra swiftc framework flags in $6
embed_appex() { # returns nonzero on failure
  local name="$1" srcdir="$2" profile="$3" ent_tmpl="$4"; shift 4
  local extra_frameworks=("$@")
  local appex="$PLUGINS/$name.appex"
  local exe="$appex/Contents/MacOS/$name"
  rm -rf "$appex"
  mkdir -p "$appex/Contents/MacOS" "$appex/Contents/Resources"

  echo "   linking $name"
  local srcs=()
  while IFS= read -r s; do srcs+=("$s"); done < <(find "$MAC/Extensions/$srcdir" -name '*.swift')
  swiftc -parse-as-library -O \
    -module-name "$name" -target "$TARGET_TRIPLE" -sdk "$SDK" \
    -I "$BIN/Modules" \
    "${srcs[@]}" "${LINK_OBJS[@]}" \
    "${extra_frameworks[@]}" \
    -Xlinker -e -Xlinker _NSExtensionMain \
    -o "$exe"

  # Info.plist: substitute the Xcode-style variables and the placeholders.
  local plist="$appex/Contents/Info.plist"
  cp "$MAC/Extensions/$srcdir/Info.plist" "$plist"
  /usr/bin/sed -i '' \
    -e "s/\$(PRODUCT_MODULE_NAME)/$name/g" \
    -e "s/\$(EXECUTABLE_NAME)/$name/g" \
    -e "s/\$(DEVELOPMENT_LANGUAGE)/en/g" \
    -e "s/TEXTTEXT_BUNDLE_ID/$BUNDLE_ID/g" \
    -e "s/TEXTTEXT_APP_GROUP/$APP_GROUP/g" \
    -e "s/TEXTTEXT_KEYCHAIN_GROUP/$KEYCHAIN_GROUP/g" \
    "$plist"
  "$PB" -c "Set :CFBundleShortVersionString $VERSION" "$plist"
  "$PB" -c "Set :CFBundleVersion $BUILD" "$plist"

  # App Store validation requires LSMinimumSystemVersion in every bundle it
  # sees, extensions included (error 90360). It is taken from the container app
  # rather than declared per extension so the two can never disagree.
  local min_system
  min_system="$($PB -c 'Print :LSMinimumSystemVersion' "$APP/Contents/Info.plist" 2>/dev/null || true)"
  if [ -n "$min_system" ]; then
    "$PB" -c "Add :LSMinimumSystemVersion string $min_system" "$plist" 2>/dev/null \
      || "$PB" -c "Set :LSMinimumSystemVersion $min_system" "$plist"
  fi

  # Embedded provisioning profile authorizes the app-group entitlement.
  cp "$profile" "$appex/Contents/embedded.provisionprofile"

  # Entitlements from the template, with the real group substituted. This file
  # must live OUTSIDE the bundle, or codesign signs it as a nested component.
  local ent; ent="$(mktemp -t texttext-appex-ent)"
  /usr/bin/sed \
    -e "s/TEXTTEXT_APP_GROUP/$APP_GROUP/g" \
    -e "s/TEXTTEXT_KEYCHAIN_GROUP/$KEYCHAIN_GROUP/g" \
    "$MAC/Extensions/$srcdir/$ent_tmpl" > "$ent"

  # TestFlight rejects a bundle signed without an application identifier when
  # its embedded profile carries one (error 90886); they have to agree. Each
  # extension's identifier is the container app's plus its own suffix, and it
  # is team-prefixed, so it is injected here rather than checked in. Only the
  # Store edition has profiles that assert one.
  local appex_bundle_id
  appex_bundle_id="$($PB -c 'Print :CFBundleIdentifier' "$plist" 2>/dev/null || true)"
  if [ "${TEXTTEXT_STORE:-0}" = "1" ] && [ -n "$TEAM" ] && [ -n "$appex_bundle_id" ]; then
    "$PB" -c "Add :com.apple.application-identifier string $TEAM.$appex_bundle_id" "$ent" 2>/dev/null \
      || "$PB" -c "Set :com.apple.application-identifier $TEAM.$appex_bundle_id" "$ent"
    "$PB" -c "Add :com.apple.developer.team-identifier string $TEAM" "$ent" 2>/dev/null \
      || "$PB" -c "Set :com.apple.developer.team-identifier $TEAM" "$ent"
  fi

  echo "   signing $name"
  codesign --force --options runtime --timestamp \
    --entitlements "$ent" --sign "$SIGN_ID" "$appex"
  rm -f "$ent"
  codesign --verify --strict "$appex"

  local signed_entitlements signed_group plist_group document_group
  if grep -q 'TEXTTEXT_APP_GROUP' "$MAC/Extensions/$srcdir/$ent_tmpl"; then
    signed_entitlements="$(mktemp -t texttext-signed-ent)"
    codesign -d --entitlements :- "$appex" > "$signed_entitlements" 2>/dev/null
    signed_group="$($PB -c 'Print :com.apple.security.application-groups:0' "$signed_entitlements" 2>/dev/null || true)"
    rm -f "$signed_entitlements"
    if [ "$signed_group" != "$APP_GROUP" ]; then
      echo "$name signed app group is '$signed_group', expected '$APP_GROUP'." >&2
      exit 1
    fi
  fi

  plist_group="$($PB -c 'Print :TextTextAppGroupIdentifier' "$plist" 2>/dev/null || true)"
  if [ -n "$plist_group" ] && [ "$plist_group" != "$APP_GROUP" ]; then
    echo "$name plist app group is '$plist_group', expected '$APP_GROUP'." >&2
    exit 1
  fi
  document_group="$($PB -c 'Print :NSExtension:NSExtensionFileProviderDocumentGroup' "$plist" 2>/dev/null || true)"
  if [ "$name" = "TextTextFileProviderExtension" ] && [ "$document_group" != "$APP_GROUP" ]; then
    echo "$name document group is '$document_group', expected '$APP_GROUP'." >&2
    exit 1
  fi
}

echo ">> embedding Share extension"
LINK_OBJS=("${CORE_OBJS[@]}")
embed_appex "TextTextShareExtension" "TextTextShareExtension" \
  "$SHARE_PROFILE" "TextTextShareExtension.entitlements.template" \
  -framework Foundation -framework AppKit -framework UniformTypeIdentifiers

echo ">> embedding Quick Look extension"
LINK_OBJS=("${CORE_OBJS[@]}")
embed_appex "TextTextQuickLookPreview" "TextTextQuickLookPreview" \
  "$QL_PROFILE" "TextTextQuickLookPreview.entitlements.template" \
  -framework Foundation -framework AppKit -framework CoreGraphics \
  -framework QuickLookUI -framework UniformTypeIdentifiers

echo ">> embedding File Provider extension"
LINK_OBJS=("${FP_OBJS[@]}")
embed_appex "TextTextFileProviderExtension" "TextTextFileProviderExtension" \
  "$FP_PROFILE" "TextTextFileProviderExtension.entitlements.template" \
  -framework Foundation -framework AppKit -framework FileProvider \
  -framework UniformTypeIdentifiers -lz

echo ">> extensions embedded and signed"
