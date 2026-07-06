#!/usr/bin/env bash
# Render mac/AppIcon.icns: a quiet serif "W" in ink on paper, on the standard
# squircle. Same technique as partyparty's make-icon.sh (inline AppKit render
# at 1024px, sips downsample, iconutil).
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

// Paper: warm near-white, with the faintest vertical falloff so it reads as
// a surface rather than a flat fill.
NSGradient(starting: NSColor(srgbRed: 0.985, green: 0.982, blue: 0.972, alpha: 1),
           ending:   NSColor(srgbRed: 0.945, green: 0.941, blue: 0.925, alpha: 1))!
    .draw(in: rect, angle: -90)

// Ink: a single serif W, near-black, dead center. No gloss, no gradient text.
let ink = NSColor(srgbRed: 0.10, green: 0.10, blue: 0.09, alpha: 1)
let size = S * 0.52
var font = NSFont.systemFont(ofSize: size, weight: .medium)
if let serif = font.fontDescriptor.withDesign(.serif),
   let serifFont = NSFont(descriptor: serif, size: size) {
    font = serifFont
}
let para = NSMutableParagraphStyle(); para.alignment = .center
let str = NSAttributedString(string: "W",
    attributes: [.font: font, .foregroundColor: ink, .paragraphStyle: para])
let bb = str.size()
str.draw(in: NSRect(x: (S - bb.width)/2, y: (S - bb.height)/2, width: bb.width, height: bb.height))

// A hairline ink border keeps the mark crisp against light backgrounds.
squircle.lineWidth = S * 0.008
ink.withAlphaComponent(0.14).setStroke()
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
echo "wrote $MAC/AppIcon.icns"
rm -rf "$TMP"
