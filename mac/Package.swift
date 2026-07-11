// swift-tools-version: 5.10
import PackageDescription

// The native Mac sync client for the Write platform: a pure AppKit shell that
// mirrors the workspace's folders to a local directory of markdown files via
// /api/sync/v1. Built with SwiftPM (no .xcodeproj) so CI is one command:
//   swift build --package-path mac
// The .app bundle is assembled by mac/scripts/build-app.sh. Sparkle is the
// app dependencies are vendored or statically linked where required.
let package = Package(
    name: "Write",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "WriteFileProviderCore", targets: ["WriteFileProviderCore"]),
        .library(name: "WriteWorkspaceCore", targets: ["WriteWorkspaceCore"])
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0"),
        .package(url: "https://github.com/SDWebImage/libwebp-Xcode", from: "1.3.2")
    ],
    targets: [
        .target(
            name: "WriteFileProviderCore",
            path: "Sources/WriteFileProviderCore"
        ),
        .target(
            name: "WriteWorkspaceCore",
            path: "Sources/WriteWorkspaceCore"
        ),
        .executableTarget(
            name: "Write",
            dependencies: [
                "WriteWorkspaceCore",
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "libwebp", package: "libwebp-Xcode")
            ],
            path: "Sources/Write"
        ),
        .testTarget(
            name: "WriteFileProviderCoreTests",
            dependencies: ["WriteFileProviderCore"],
            path: "Tests/WriteFileProviderCoreTests"
        ),
        .testTarget(
            name: "WriteWorkspaceCoreTests",
            dependencies: ["WriteWorkspaceCore"],
            path: "Tests/WriteWorkspaceCoreTests"
        ),
        .testTarget(
            name: "WriteTests",
            dependencies: ["Write"],
            path: "Tests/WriteTests"
        )
    ]
)
