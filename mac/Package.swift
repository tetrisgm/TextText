// swift-tools-version: 5.10
import PackageDescription

// The native Mac client for the TextText platform: a pure AppKit shell whose File
// Provider extension materializes the server-backed workspace in Finder.
// Built with SwiftPM (no .xcodeproj) so CI is one command:
//   swift build --package-path mac
// The .app bundle is assembled by mac/scripts/build-app.sh. Sparkle is the
// app dependencies are vendored or statically linked where required.
/// The Store edition links no updater.
///
/// Sparkle cannot be excluded by the bundle assembler alone: the executable
/// links @rpath/Sparkle.framework, so a bundle without the framework dies at
/// launch with a dyld error. The dependency has to be absent from the LINK,
/// which means the manifest has to know which edition is being built.
///
/// TEXTTEXT_STORE=1 selects it, the same variable mac/scripts/build-app.sh
/// reads, so one switch drives the manifest and the bundle.
let storeEdition = Context.environment["TEXTTEXT_STORE"] == "1"

let updaterDependencies: [Target.Dependency] =
    storeEdition ? [] : [.product(name: "Sparkle", package: "Sparkle")]

let updaterPackages: [Package.Dependency] =
    storeEdition ? [] : [.package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0")]

/// `#if TEXTTEXT_STORE` guards every line that touches Sparkle.
let editionSwiftSettings: [SwiftSetting] =
    storeEdition ? [.define("TEXTTEXT_STORE")] : []

let package = Package(
    name: "TextText",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "TextTextWorkspaceCore", targets: ["TextTextWorkspaceCore"]),
        .library(name: "TextTextShareCore", targets: ["TextTextShareCore"]),
        .library(name: "TextTextEditor", targets: ["TextTextEditor"]),
        .library(name: "TextTextAppIntents", targets: ["TextTextAppIntents"]),
        .library(name: "TextTextSpotlight", targets: ["TextTextSpotlight"]),
        .library(name: "TextTextShareExtensionCore", targets: ["TextTextShareExtensionCore"]),
        .library(name: "TextTextQuickLookCore", targets: ["TextTextQuickLookCore"]),
        .library(name: "TextTextFileProviderKit", targets: ["TextTextFileProviderKit"]),
        .library(name: "TextTextFileProviderBridge", targets: ["TextTextFileProviderBridge"]),
        .library(name: "TextTextFileProviderExtensionCore", targets: ["TextTextFileProviderExtensionCore"]),
        .library(name: "TextTextCLICore", targets: ["TextTextCLICore"]),
        .executable(name: "texttext", targets: ["TextTextCLI"])
    ],
    dependencies: [
        // Sparkle is appended below, and only for the non-Store edition.
        .package(url: "https://github.com/SDWebImage/libwebp-Xcode", from: "1.3.2"),
        .package(url: "https://github.com/weichsel/ZIPFoundation", from: "0.9.19")
    ] + updaterPackages,
    targets: [
        .target(
            name: "TextTextWorkspaceCore",
            path: "Sources/TextTextWorkspaceCore",
            swiftSettings: editionSwiftSettings
        ),
        .target(
            name: "TextTextShareCore",
            path: "Sources/TextTextShareCore"
        ),
        .target(
            name: "TextTextEditor",
            dependencies: ["TextTextWorkspaceCore"],
            path: "Sources/TextTextEditor"
        ),
        .target(
            name: "TextTextCapabilitySpec",
            path: "Sources/TextTextCapabilitySpec"
        ),
        .target(
            name: "TextTextAppIntents",
            dependencies: ["TextTextWorkspaceCore"],
            path: "Sources/TextTextAppIntents"
        ),
        .target(
            name: "TextTextSpotlight",
            dependencies: ["TextTextWorkspaceCore"],
            path: "Sources/TextTextSpotlight"
        ),
        .target(
            name: "TextTextShareExtensionCore",
            dependencies: ["TextTextShareCore"],
            path: "Extensions/TextTextShareExtension",
            exclude: ["Info.plist", "TextTextShareExtension.entitlements.template"]
        ),
        .target(
            name: "TextTextQuickLookCore",
            dependencies: ["TextTextShareCore"],
            path: "Extensions/TextTextQuickLookPreview",
            exclude: ["Info.plist", "TextTextQuickLookPreview.entitlements.template"]
        ),
        .target(
            name: "TextTextFileProviderKit",
            dependencies: [
                .product(name: "ZIPFoundation", package: "ZIPFoundation")
            ],
            path: "Sources/TextTextFileProviderKit"
        ),
        .target(
            name: "TextTextCLICore",
            dependencies: ["TextTextFileProviderKit"],
            path: "Sources/TextTextCLICore"
        ),
        .executableTarget(
            name: "TextTextCLI",
            dependencies: ["TextTextCLICore"],
            path: "Sources/TextTextCLI"
        ),
        .target(
            name: "TextTextFileProviderBridge",
            dependencies: ["TextTextFileProviderKit"],
            path: "Sources/TextTextFileProviderBridge"
        ),
        .target(
            // The replicated File Provider extension's Swift sources, compiled
            // as a library so `swift test` can exercise them. The .appex itself
            // is linked separately by mac/scripts/embed-extensions.sh.
            name: "TextTextFileProviderExtensionCore",
            dependencies: ["TextTextFileProviderBridge"],
            path: "Extensions/TextTextFileProviderExtension",
            exclude: ["Info.plist", "TextTextFileProviderExtension.entitlements.template"]
        ),
        // NOT "TextText": the CLI product is `texttext`, and a stock Mac volume
        // is case-insensitive, so both executables landed on one path in
        // .build and whichever linked last won. The bundle binary is still
        // named TextText (build-app.sh copies it into place).
        .executableTarget(
            name: "TextTextApp",
            dependencies: [
                "TextTextShareCore",
                "TextTextWorkspaceCore",
                "TextTextAppIntents",
                "TextTextSpotlight",
                "TextTextFileProviderKit",
                .product(name: "libwebp", package: "libwebp-Xcode")
            ] + updaterDependencies,
            path: "Sources/TextText",
            swiftSettings: editionSwiftSettings
        ),
        .executableTarget(
            // Depends only on the standalone spec module so a manifest edit
            // can always regenerate, even when generated code is stale.
            name: "capability-generator",
            dependencies: ["TextTextCapabilitySpec"],
            path: "Tools/CapabilityGenerator"
        ),
        .testTarget(
            name: "TextTextCLICoreTests",
            dependencies: ["TextTextCLICore", "TextTextFileProviderKit"],
            path: "Tests/TextTextCLICoreTests"
        ),
        .testTarget(
            name: "TextTextWorkspaceCoreTests",
            dependencies: ["TextTextWorkspaceCore"],
            path: "Tests/TextTextWorkspaceCoreTests"
        ),
        .testTarget(
            name: "TextTextEditorTests",
            dependencies: ["TextTextEditor"],
            path: "Tests/TextTextEditorTests"
        ),
        .testTarget(
            name: "TextTextAppIntentsTests",
            dependencies: ["TextTextAppIntents", "TextTextCapabilitySpec"],
            path: "Tests/TextTextAppIntentsTests"
        ),
        .testTarget(
            name: "TextTextSpotlightTests",
            dependencies: ["TextTextSpotlight"],
            path: "Tests/TextTextSpotlightTests"
        ),
        .testTarget(
            name: "TextTextShareCoreTests",
            dependencies: [
                "TextTextApp",
                "TextTextShareCore",
                "TextTextShareExtensionCore",
                "TextTextQuickLookCore",
            ],
            path: "Tests/TextTextShareCoreTests"
        ),
        .testTarget(
            name: "TextTextTests",
            dependencies: [
                "TextTextApp",
                "TextTextWorkspaceCore",
                "TextTextFileProviderExtensionCore",
                "TextTextFileProviderBridge",
                "TextTextFileProviderKit",
            ],
            path: "Tests/TextTextTests"
        ),
        .testTarget(
            name: "TextTextFileProviderKitTests",
            dependencies: ["TextTextFileProviderKit"],
            path: "Tests/TextTextFileProviderKitTests"
        ),
        .testTarget(
            name: "TextTextFileProviderBridgeTests",
            dependencies: ["TextTextFileProviderBridge", "TextTextFileProviderKit"],
            path: "Tests/TextTextFileProviderBridgeTests"
        ),
        .testTarget(
            name: "TextTextFileProviderExtensionCoreTests",
            dependencies: [
                "TextTextFileProviderExtensionCore",
                "TextTextFileProviderBridge",
                "TextTextFileProviderKit"
            ],
            path: "Tests/TextTextFileProviderExtensionCoreTests"
        )
    ]
)
