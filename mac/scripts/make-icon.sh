#!/usr/bin/env bash
# Render mac/AppIcon.icns: a publishing mark inspired by the newspaper emoji,
# with a masthead, lead image, and text columns on the standard squircle.
set -euo pipefail
cd "$(dirname "$0")/.."
MAC="$(pwd)"
TMP="$(mktemp -d)"

cat > "$TMP/render.swift" <<'SWIFT'
import AppKit
let out = CommandLine.arguments[1]
let S = 1024.0
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(S), pixelsHigh: Int(S),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let m = S * 0.06
let rect = NSRect(x: m, y: m, width: S - 2*m, height: S - 2*m)
let r = (S - 2*m) * 0.2237
let squircle = NSBezierPath(roundedRect: rect, xRadius: r, yRadius: r)
squircle.addClip()

let emojiFont = NSFont(name: "Apple Color Emoji", size: S * 0.58) ?? NSFont.systemFont(ofSize: S * 0.58)
let emoji = NSAttributedString(string: "📰", attributes: [.font: emojiFont])
let emojiBounds = emoji.size()
emoji.draw(at: NSPoint(x: (S - emojiBounds.width) / 2, y: (S - emojiBounds.height) / 2 - S * 0.01))

squircle.lineWidth = S * 0.008
NSColor(srgbRed: 0.08, green: 0.11, blue: 0.16, alpha: 0.14).setStroke()
squircle.stroke()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
SWIFT

swift "$TMP/render.swift" "$TMP/icon-1024.png"

ICONSET="$TMP/icon.iconset"; mkdir -p "$ICONSET"
gen() { sips -z "$1" "$1" "$TMP/icon-1024.png" --out "$ICONSET/$2" >/dev/null; }
gen 16 icon_16x16.png;     gen 32  icon_16x16@2x.png
gen 32 icon_32x32.png;     gen 64  icon_32x32@2x.png
gen 128 icon_128x128.png;  gen 256 icon_128x128@2x.png
gen 256 icon_256x256.png;  gen 512 icon_256x256@2x.png
gen 512 icon_512x512.png;  gen 1024 icon_512x512@2x.png
iconutil -c icns "$ICONSET" -o "$MAC/AppIcon.icns"
cp "$ICONSET"/*.png "$MAC/Assets.xcassets/AppIcon.appiconset/"
echo "wrote $MAC/AppIcon.icns"
rm -rf "$TMP"
