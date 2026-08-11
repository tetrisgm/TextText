# The Mac App Store edition

TextText ships as two Mac apps from one source tree. The standalone edition is
Developer ID signed, updates itself through Sparkle, and is what
`release/ship.sh` builds. The Store edition is sandboxed, has no updater, and is
what TestFlight and the App Store distribute.

`mac/scripts/build-store.sh` builds the second one. It sets `TEXTTEXT_STORE=1`
and calls `mac/scripts/build-app.sh`, which is the only build script; there is
no separate Store build path to drift out of step.

## What the edition flag changes

| | standalone | Store |
| --- | --- | --- |
| Sandbox | no | yes, `mac/texttext-app-store.entitlements` |
| Sparkle | linked and embedded | not a package dependency at all |
| `texttext` CLI | `Contents/Helpers/texttext` | absent |
| Self-relocation | offers to move to /Applications | compiled out |
| Signing identity | Developer ID Application | Apple Distribution |
| Profile | `mac/profiles/*_DeveloperID.provisionprofile` | `*_AppStore.provisionprofile` |

Sparkle is excluded through conditional linkage in `mac/Package.swift`, not by
deleting files afterwards. A shell-level exclusion was tried first and the app
died at launch on a missing `@rpath/Sparkle.framework`: the binary still had the
load command. `Updater.swift` compiles to a stub under `#if TEXTTEXT_STORE`.

The CLI is absent by design rather than oversight. Every nested executable in a
Store bundle must carry `com.apple.security.app-sandbox`, and a sandboxed CLI
would run in its own container instead of the app's, with the PATH symlink
landing inside that container where no shell can reach it. Shipping it would
mean shipping something that cannot work, at the cost of a rejected upload.
`scripts/verify-agent-interoperability.ts` asserts both halves: the standalone
edition ships it in `Contents/Helpers`, and the Store edition does not ship it.

## Why a Store build will not run locally

It will not launch, and that is correct rather than broken. A Mac App Store
distribution-signed build can only be installed by the store or by TestFlight;
launching one directly fails with `Launch failed` and POSIX 163. Local testing
of the Store shape needs a development-signed build of the same bundle. That
sub-mode is not written yet.

## Apple-side identity

The product was renamed from Write to TextText and the identifiers did not
follow, so everything registered was under `net.writeapp.write.*` while the app
builds as `app.texttext.mac`. Registered since, through the App Store Connect
API: `app.texttext.mac` plus `.share`, `.fileprovider` and `.quicklook`, App
Groups on the app, share and file provider, and a `MAC_APP_STORE` provisioning
profile for each. App Store Connect app id `6800104777`, "TextText - AI Text
Editor", primary category Productivity.

`LSApplicationCategoryType` lives in `mac/Info.plist` and must stay in step with
that primary category. It is an Info.plist key rather than storefront metadata,
and without it the product archive is rejected at upload.

The build stamps `DTPlatformName`, `DTSDKName`, `DTSDKBuild`, `DTXcode`,
`DTXcodeBuild`, `DTCompiler`, `BuildMachineOSBuild` and
`CFBundleSupportedPlatforms` from the active toolchain. Xcode writes these into
everything it produces; this app is assembled by hand from a SwiftPM build, so
nothing wrote them and the bundle arrived at App Store Connect looking like it
came from no known toolchain.

`mac/Info.plist` carries no XML comments, and cannot. Every release rewrites it
through PlistBuddy to stamp the version, and PlistBuddy drops comments on any
write, including `Set`. So the reasoning behind its less obvious keys lives
here rather than beside them: `ITSAppUsesNonExemptEncryption` is false because
the app encrypts only by using HTTPS and the system Keychain, which is the
standard-encryption exemption, and without the key every TestFlight upload stops
to ask a human the same question. `LSApplicationCategoryType` must match the
primary category on the store record, and without it the product archive is
rejected at upload.

`mac/PrivacyInfo.xcprivacy` declares the three required-reason APIs the code
actually uses: file timestamps, `ProcessInfo.systemUptime` as a monotonic clock,
and `UserDefaults`. ZIPFoundation is linked statically, which drops its own
manifest, so its file-timestamp use is covered there too.

## Still open

- No development-signed Store build for local testing.
- Apple's `/auth/revoke` is not called on account deletion. No Apple refresh
  token is stored anywhere, so it is not currently possible; see
  `src/lib/account-deletion.ts`.
- The app builds `0.169`-series versions while the App Store version record was
  created as `1.0`. One of the two has to move before a submission.
