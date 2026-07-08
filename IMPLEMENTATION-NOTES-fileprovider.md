# File Provider Phase 1 Implementation Notes

## Scope

- Added a SwiftPM library product and target named `WriteFileProviderCore`.
- Added pure core models for workspace folders, manifest markdown items, File Provider shaped item metadata, item versions, page tokens, and change anchors.
- Added a small async `WriteFileProviderAPI` protocol for workspace, manifest, fetch, create, modify, delete, and change cursor polling.
- Added `WriteFileProviderCore` orchestration for `item(for:)`, enumeration, change enumeration, content fetch, create, modify, and delete.
- Added XCTest coverage for metadata mapping, paged enumeration, change anchors, and write-back version plumbing.
- Added Xcode-only File Provider extension scaffolding under `mac/FileProvider/Extension/`.
- Added File Provider Info.plist and entitlement templates with neutral `net.example.*` and `REPLACE_WITH` placeholders.

## Design Source Note

The requested authoritative design file, `docs/design/native-folder-sync.md`, is not present in this worktree. The scaffold was aligned to the current mac sync sources and `docs/PLAN-2026-07-07.md`, specifically the existing workspace, folder manifest, markdown fetch, PUT, POST, DELETE, folder creation, and change cursor concepts.

## Headless Build Boundary

`WriteFileProviderCore` builds and tests through SwiftPM. The actual `.appex` source is intentionally under `mac/FileProvider/Extension/`, not under `mac/Sources/`, so SwiftPM does not treat it as a stray target. That file must be added to an Xcode File Provider extension target and wired to a concrete sync API adapter before packaging.

## Verification

The managed sandbox denied SwiftPM writes to `/Users/shokunin/.cache` and rejected SwiftPM's nested `sandbox-exec`, so verification used writable package-local cache paths and `--disable-sandbox` for SwiftPM's own nested sandbox.

Build passed:

```sh
env CLANG_MODULE_CACHE_PATH=/Users/shokunin/dev/write-wt-fileprovider/mac/.build/module-cache swift build --package-path mac --cache-path /Users/shokunin/dev/write-wt-fileprovider/mac/.build/cache --config-path /Users/shokunin/dev/write-wt-fileprovider/mac/.build/config --security-path /Users/shokunin/dev/write-wt-fileprovider/mac/.build/security --manifest-cache local --skip-update --disable-sandbox
```

Tests passed:

```sh
env CLANG_MODULE_CACHE_PATH=/Users/shokunin/dev/write-wt-fileprovider/mac/.build/module-cache swift test --package-path mac --cache-path /Users/shokunin/dev/write-wt-fileprovider/mac/.build/cache --config-path /Users/shokunin/dev/write-wt-fileprovider/mac/.build/config --security-path /Users/shokunin/dev/write-wt-fileprovider/mac/.build/security --manifest-cache local --skip-update --disable-sandbox
```

Test result: 3 tests, 0 failures.
