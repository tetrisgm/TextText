# Write File Provider Extension Scaffold

This directory contains Phase 1 packaging scaffolding for a macOS File Provider extension. The reusable logic lives in the SwiftPM target `WriteFileProviderCore`; the extension source in `Extension/` is not part of SwiftPM and must be added to an Xcode extension target.

## Xcode Target Wiring

1. Create a macOS File Provider extension target in Xcode.
2. Set its extension point to `com.apple.fileprovider-nonui`.
3. Use `mac/FileProvider/Info.plist` as the starting Info.plist.
4. Add `mac/FileProvider/Extension/WriteFileProviderExtension.swift` to the extension target.
5. Link the extension target with `WriteFileProviderCore`, `FileProvider.framework`, and `UniformTypeIdentifiers.framework`.
6. Replace neutral placeholders:
   - Container app bundle id: `net.example.write.REPLACE_WITH`
   - Extension bundle id: `net.example.write.fileprovider.REPLACE_WITH`
   - App group: `group.net.example.write.REPLACE_WITH`
   - Domain id: `net.example.write.domain.REPLACE_WITH`
7. Implement `XcodeWiredSyncAPI` in the extension target. It should read shared credentials from the app group container and call the existing sync API concepts: workspace, folder manifest, file fetch, create folder, create markdown, modify markdown, delete markdown, and changes cursor polling.

The extension source is deliberately outside `mac/Sources/`. `swift build --package-path mac` verifies only the headless core library and the existing `Write` executable. The `.appex` must be compiled and packaged by Xcode later.

## Entitlements

Use `ContainerApp.entitlements.template` for the container app and `WriteFileProviderExtension.entitlements.template` for the extension. The app group value must match in both targets and in `NSExtensionFileProviderDocumentGroup`. The container app template also includes local File Provider testing mode because the container registers domains.

The extension template includes:

- `com.apple.security.app-sandbox`
- `com.apple.security.application-groups`
- `com.apple.developer.fileprovider.testing-mode`

`com.apple.developer.fileprovider.testing-mode` is for local development. For distribution, remove testing mode from both targets and use the File Provider capability and entitlements approved for the Apple Developer team that signs the app.

## Domain Registration

Register the File Provider domain from the container app after the user links an account and the app group credentials are available:

```swift
import FileProvider

let domain = NSFileProviderDomain(
    identifier: NSFileProviderDomainIdentifier("net.example.write.domain.REPLACE_WITH"),
    displayName: "Write"
)

NSFileProviderManager.add(domain) { error in
    if let error {
        // Surface this in the app UI or logs.
        print("Could not register File Provider domain: \(error)")
    }
}
```

On sign out, remove the domain with `NSFileProviderManager.remove(_:completionHandler:)` and clear shared app group credentials. When the container app learns about remote changes outside the extension, call `NSFileProviderManager.signalEnumerator(for:completionHandler:)` for the affected container or root.

## Developer ID and Notarization

The shipping app must include the `.appex` inside the signed `.app` bundle. Sign both the container app and extension with matching Team ID, app group, hardened runtime, and production File Provider entitlements. Notarize the full app bundle after embedding the extension. A build signed only with the testing-mode entitlement is a development build, not a Developer ID distribution build.
