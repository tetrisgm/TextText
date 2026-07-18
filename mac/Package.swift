// swift-tools-version: 5.10
import PackageDescription

// The native Mac client for the Write platform: a pure AppKit shell whose File
// Provider extension materializes the server-backed workspace in Finder.
// Built with SwiftPM (no .xcodeproj) so CI is one command:
//   swift build --package-path mac
// The .app bundle is assembled by mac/scripts/build-app.sh. Sparkle is the
// app dependencies are vendored or statically linked where required.
let package = Package(
    name: "Write",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "WriteWorkspaceCore", targets: ["WriteWorkspaceCore"]),
        .library(name: "WriteShareCore", targets: ["WriteShareCore"]),
        .library(name: "WriteEditor", targets: ["WriteEditor"]),
        .library(name: "WriteAppIntents", targets: ["WriteAppIntents"]),
        .library(name: "WriteSpotlight", targets: ["WriteSpotlight"]),
        .library(name: "WriteShareExtensionCore", targets: ["WriteShareExtensionCore"]),
        .library(name: "WriteQuickLookCore", targets: ["WriteQuickLookCore"]),
        .library(name: "WriteFileProviderKit", targets: ["WriteFileProviderKit"]),
        .library(name: "WriteFileProviderBridge", targets: ["WriteFileProviderBridge"]),
        .library(name: "WriteFileProviderExtensionCore", targets: ["WriteFileProviderExtensionCore"])
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0"),
        .package(url: "https://github.com/SDWebImage/libwebp-Xcode", from: "1.3.2"),
        .package(url: "https://github.com/weichsel/ZIPFoundation", from: "0.9.19")
    ],
    targets: [
        .target(
            name: "WriteWorkspaceCore",
            path: "Sources/WriteWorkspaceCore"
        ),
        .target(
            name: "WriteShareCore",
            path: "Sources/WriteShareCore"
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
        .target(
            name: "WriteShareExtensionCore",
            dependencies: ["WriteShareCore"],
            path: "Extensions/WriteShareExtension",
            exclude: ["Info.plist", "WriteShareExtension.entitlements.template"]
        ),
        .target(
            name: "WriteQuickLookCore",
            dependencies: ["WriteShareCore"],
            path: "Extensions/WriteQuickLookPreview",
            exclude: ["Info.plist", "WriteQuickLookPreview.entitlements.template"]
        ),
        .target(
            name: "WriteFileProviderKit",
            dependencies: [
                .product(name: "ZIPFoundation", package: "ZIPFoundation")
            ],
            path: "Sources/WriteFileProviderKit"
        ),
        .target(
            name: "WriteFileProviderBridge",
            dependencies: ["WriteFileProviderKit"],
            path: "Sources/WriteFileProviderBridge"
        ),
        .target(
            // The replicated File Provider extension's Swift sources, compiled
            // as a library so `swift test` can exercise them. The .appex itself
            // is linked separately by mac/scripts/embed-extensions.sh.
            name: "WriteFileProviderExtensionCore",
            dependencies: ["WriteFileProviderBridge"],
            path: "Extensions/WriteFileProviderExtension",
            exclude: ["Info.plist", "WriteFileProviderExtension.entitlements.template"]
        ),
        .executableTarget(
            name: "Write",
            dependencies: [
                "WriteShareCore",
                "WriteWorkspaceCore",
                "WriteAppIntents",
                "WriteSpotlight",
                "WriteFileProviderKit",
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
            name: "WriteShareCoreTests",
            dependencies: [
                "Write",
                "WriteShareCore",
                "WriteShareExtensionCore",
                "WriteQuickLookCore",
            ],
            path: "Tests/WriteShareCoreTests"
        ),
        .testTarget(
            name: "WriteTests",
            dependencies: [
                "Write",
                "WriteFileProviderExtensionCore",
                "WriteFileProviderBridge",
                "WriteFileProviderKit",
            ],
            path: "Tests/WriteTests"
        ),
        .testTarget(
            name: "WriteFileProviderKitTests",
            dependencies: ["WriteFileProviderKit"],
            path: "Tests/WriteFileProviderKitTests"
        ),
        .testTarget(
            name: "WriteFileProviderBridgeTests",
            dependencies: ["WriteFileProviderBridge", "WriteFileProviderKit"],
            path: "Tests/WriteFileProviderBridgeTests"
        ),
        .testTarget(
            name: "WriteFileProviderExtensionCoreTests",
            dependencies: [
                "WriteFileProviderExtensionCore",
                "WriteFileProviderBridge",
                "WriteFileProviderKit"
            ],
            path: "Tests/WriteFileProviderExtensionCoreTests"
        )
    ]
)
