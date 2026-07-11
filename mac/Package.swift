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
        .library(name: "WriteWorkspaceCore", targets: ["WriteWorkspaceCore"]),
        .library(name: "WriteEditor", targets: ["WriteEditor"]),
        .library(name: "WriteAppIntents", targets: ["WriteAppIntents"]),
        .library(name: "WriteSpotlight", targets: ["WriteSpotlight"])
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0"),
        .package(url: "https://github.com/SDWebImage/libwebp-Xcode", from: "1.3.2")
    ],
    targets: [
        .target(
            name: "WriteWorkspaceCore",
            path: "Sources/WriteWorkspaceCore"
        ),
        .target(
            name: "WriteEditor",
            dependencies: ["WriteWorkspaceCore"],
            path: "Sources/WriteEditor"
        ),
        .target(
            name: "WriteCapabilitySpec",
            path: "Sources/WriteCapabilitySpec"
        ),
        .target(
            name: "WriteAppIntents",
            dependencies: ["WriteWorkspaceCore"],
            path: "Sources/WriteAppIntents"
        ),
        .target(
            name: "WriteSpotlight",
            dependencies: ["WriteWorkspaceCore"],
            path: "Sources/WriteSpotlight"
        ),
        .executableTarget(
            name: "Write",
            dependencies: [
                "WriteEditor",
                "WriteWorkspaceCore",
                "WriteAppIntents",
                "WriteSpotlight",
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "libwebp", package: "libwebp-Xcode")
            ],
            path: "Sources/Write"
        ),
        .executableTarget(
            // Depends only on the standalone spec module so a manifest edit
            // can always regenerate, even when generated code is stale.
            name: "capability-generator",
            dependencies: ["WriteCapabilitySpec"],
            path: "Tools/CapabilityGenerator"
        ),
        .testTarget(
            name: "WriteWorkspaceCoreTests",
            dependencies: ["WriteWorkspaceCore"],
            path: "Tests/WriteWorkspaceCoreTests"
        ),
        .testTarget(
            name: "WriteEditorTests",
            dependencies: ["WriteEditor"],
            path: "Tests/WriteEditorTests"
        ),
        .testTarget(
            name: "WriteAppIntentsTests",
            dependencies: ["WriteAppIntents", "WriteCapabilitySpec"],
            path: "Tests/WriteAppIntentsTests"
        ),
        .testTarget(
            name: "WriteSpotlightTests",
            dependencies: ["WriteSpotlight"],
            path: "Tests/WriteSpotlightTests"
        ),
        .testTarget(
            name: "WriteTests",
            dependencies: ["Write"],
            path: "Tests/WriteTests"
        )
    ]
)
