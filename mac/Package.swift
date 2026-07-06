// swift-tools-version: 5.10
import PackageDescription

// The native Mac sync client for the Write platform: a pure AppKit shell that
// mirrors the workspace's folders to a local directory of markdown files via
// /api/sync/v1. Built with SwiftPM (no .xcodeproj) so CI is one command:
//   swift build --package-path mac
// The .app bundle is assembled by mac/scripts/build-app.sh. Sparkle is the
// single dependency (auto-update).
let package = Package(
    name: "Write",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0")
    ],
    targets: [
        .executableTarget(
            name: "Write",
            dependencies: [.product(name: "Sparkle", package: "Sparkle")],
            path: "Sources/Write"
        )
    ]
)
