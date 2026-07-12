#!/usr/bin/env bash
# Build, embed, and sign the Share and Quick Look app extensions into an
# already-assembled Write.app, inside-out, before the main app is signed.
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
# the sync token (<TeamID>.net.writeapp.write.fp). Resolve the team from the
# signing identity so the Info.plist carries the same string the app does.
TEAM="$(printf '%s' "$SIGN_ID" | sed -n 's/.*(\([A-Z0-9]\{8,\}\))$/\1/p')"
KEYCHAIN_GROUP="${TEAM:+$TEAM.net.writeapp.write.fp}"

SHARE_PROFILE="$MAC/profiles/Write_Share_Developer_ID.provisionprofile"
QL_PROFILE="$MAC/profiles/Write_QuickLook_Developer_ID.provisionprofile"
FP_PROFILE="$MAC/profiles/Write_FileProvider_Developer_ID.provisionprofile"
if [ ! -f "$SHARE_PROFILE" ] || [ ! -f "$QL_PROFILE" ] || [ ! -f "$FP_PROFILE" ]; then
  echo ">> extensions: no provisioning profiles in mac/profiles; skipping embed"
  exit 0
fi
if [ "$SIGN_ID" = "-" ]; then
  echo ">> extensions: app-group entitlements need a real Developer ID identity; skipping embed (ad-hoc build)"
  exit 0
fi

BIN="$(swift build -c release --package-path "$MAC" --show-bin-path)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
TARGET_TRIPLE="arm64-apple-macosx14.0"
PLUGINS="$APP/Contents/PlugIns"
mkdir -p "$PLUGINS"

# WriteShareCore (Foundation only) is the sole library dependency of the Share
# and Quick Look extensions; collect its release objects once.
CORE_OBJS=()
while IFS= read -r f; do CORE_OBJS+=("$f"); done < <(find "$BIN/WriteShareCore.build" -name '*.o')
[ "${#CORE_OBJS[@]}" -gt 0 ] || { echo "no WriteShareCore objects; run swift build -c release first" >&2; exit 1; }

# The File Provider extension depends instead on the FP Kit + Bridge (not
# WriteShareCore); collect their release objects for its dedicated link. The
# extension's own two sources are compiled fresh by embed_appex below, so do NOT
# also link WriteFileProviderExtensionCore objects (that would double symbols).
FP_OBJS=()
while IFS= read -r f; do FP_OBJS+=("$f"); done < <(find \
  "$BIN/WriteFileProviderKit.build" "$BIN/WriteFileProviderBridge.build" -name '*.o')
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
    -e "s/WRITE_BUNDLE_ID/$BUNDLE_ID/g" \
    -e "s/WRITE_APP_GROUP/$APP_GROUP/g" \
    -e "s/WRITE_KEYCHAIN_GROUP/$KEYCHAIN_GROUP/g" \
    "$plist"
  "$PB" -c "Set :CFBundleShortVersionString $VERSION" "$plist"
  "$PB" -c "Set :CFBundleVersion $BUILD" "$plist"

  # Embedded provisioning profile authorizes the app-group entitlement.
  cp "$profile" "$appex/Contents/embedded.provisionprofile"

  # Entitlements from the template, with the real group substituted. This file
  # must live OUTSIDE the bundle, or codesign signs it as a nested component.
  local ent; ent="$(mktemp -t write-appex-ent)"
  /usr/bin/sed "s/WRITE_APP_GROUP/$APP_GROUP/g" "$MAC/Extensions/$srcdir/$ent_tmpl" > "$ent"

  echo "   signing $name"
  codesign --force --options runtime --timestamp \
    --entitlements "$ent" --sign "$SIGN_ID" "$appex"
  rm -f "$ent"
  codesign --verify --strict "$appex"
}

echo ">> embedding Share extension"
LINK_OBJS=("${CORE_OBJS[@]}")
embed_appex "WriteShareExtension" "WriteShareExtension" \
  "$SHARE_PROFILE" "WriteShareExtension.entitlements.template" \
  -framework Foundation -framework AppKit -framework UniformTypeIdentifiers

echo ">> embedding Quick Look extension"
LINK_OBJS=("${CORE_OBJS[@]}")
embed_appex "WriteQuickLookPreview" "WriteQuickLookPreview" \
  "$QL_PROFILE" "WriteQuickLookPreview.entitlements.template" \
  -framework Foundation -framework AppKit -framework CoreGraphics \
  -framework QuickLookUI -framework UniformTypeIdentifiers

echo ">> embedding File Provider extension"
LINK_OBJS=("${FP_OBJS[@]}")
embed_appex "WriteFileProviderExtension" "WriteFileProviderExtension" \
  "$FP_PROFILE" "WriteFileProviderExtension.entitlements.template" \
  -framework Foundation -framework FileProvider -framework UniformTypeIdentifiers

echo ">> extensions embedded and signed"
