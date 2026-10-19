# Windows external-image write and shared reopen

Actual Windows counterpart passed; no Windows production change was needed.

## Source and gates

The isolated source was committed `4fdddd4ad9d854f1523c16ca1836e92d17e3b501` plus exactly the two test files below. Its native/policy inputs matched committed HEAD at preparation; concurrent typed-generation drafts were excluded.

| File | SHA-256 |
| --- | --- |
| `windows/TextText.Windows.Tests/Program.cs` | `9f8afeebe4ad9d0b1d46c703e070c80478786f7821592d76cd8ac4363897cd07` |
| `windows/TextText.Windows.Tests/ExternalAssetReopenTests.cs` | `eed59b31e686fd741c3caf1f3acc90803c85c4d2d7093e5208683f5c7ebc33eb` |

- Actual PC default Windows bridge suite: **128 checks passed**, build/runtime exit 0. All 3,339 input files matched before/after.
- Mac portable default suite: **70 checks passed**, exit 0, empty stderr. Existing folder-recovery filesystem fixtures and the new external-image retained-replacement positive explicitly require Windows. Owner Package.resolved remained unchanged.
- Command: `dotnet run --project windows/TextText.Windows.Tests/TextText.Windows.Tests.csproj --configuration Release --disable-build-servers -p:UseSharedCompilation=false`.

## Observed contract

The test uses the real Windows bridge, HttpSyncTransport and packaged policy host. A controlled scheduler holds ordinary sync while a clean shared session closes and an external JPEG CAS completes. It checks that Changed fires after readable committed bytes, that a fresh shared session sees the image before baseline advancement, and that releasing sync produces the exact server full snapshot/JPEG and a ready empty target upload queue.

The test-only handler routes only the fixed HTTPS fixture origin to an owned real HTTP socket. The listener uses the production C# TextPackStore CAS implementation. This proves the protocol/bridge behavior, not TLS, production authentication or Oracle behavior. The prior TypeScript server preparation returned EPERM during directory fsync on Windows; that platform fixture limitation and the other preparation failures remain preserved, not product RED evidence.

Windows already emits Changed after successful file CAS. This passing counterpart does not establish the Mac wake-up bug on Windows. No normal root, real workspace item, account or installed app was changed.

## Private evidence

- `/private/tmp/texttext-windows-image-reopen-http-20261019/retry5-result.json`: actual PC result and exact overlay attribution; adjacent source inventories and build/runtime logs preserve the full run.
- `postflight-final.json` in that directory: no owned children or normal app, no matching bad-logon events, mitigation retained.
- `/private/tmp/texttext-windows-image-reopen-portable-mac-20261019/final-result.json`: portable result, exact source hashes and log hashes. Portable stdout SHA-256 `62ae94a1acabc70283e6cc9da9450a731c2bddcac449582de452be6b9775cae2`.

These are isolated tests, not normal installed editing acceptance or typed-absence implementation proof.
