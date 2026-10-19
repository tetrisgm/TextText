# Mac c84 private artifacts and read-only bootstrap

Source: `c84e192719670bb9d6dd7ee74c68e8f33900c1e5`. This receipt covers private harness artifacts, not a normal release, six-client acceptance, edits, or guarded close-probe acceptance. Installed normal a041/1270 was unchanged.

## Build and recovery

All three roles have 3,258 source inputs, SHA-256 `6bfc346384f67ee3192584e911cbd71a7050a0f14a74d9c0252aea826f02704c`; archive SHA-256 `00c5e20791063caf849370904866314c65ff0f9f30b102f5cfd0a6097df61adb`.

The original app wrapper exited 1 during Xcode compilation, after recording only locked npm as passed. Preserve `/private/tmp/texttext-private-mac-app-c84e1927-20261019/failure.json` and original log `/private/tmp/texttext-private-mac-app-c84e1927-20261019.log` (SHA-256 `35ae212a9ed4dcc649234c2998f005716b447c911d2d4275fed10e8c96ff072d`). Xcode reported failed SwiftCompile commands with exit code 0 and no further output. A fresh owned DerivedData/result-bundle probe succeeded with zero errors. This does not establish the specific original toolchain failure cause.

Both original App Intents const-value files were byte-identical to the independent successful probe, with official source-mtime guards satisfied. The approved one-off recovery preserved the partial app by same-volume rename, used unchanged `build-store.sh` with its supported `TEXTTEXT_LOCAL_CACHED_APPINTENTS=1`, and executed the exact remaining actor build/sign/verify commands. Every actual command passed. No source, validator, or provenance guard was changed. Optional release attestation/capability variables were omitted; there is no release-health claim.

Recovery evidence: `/private/tmp/texttext-private-mac-c84-recovery-evidence-20261019/actual-command-chain.json`, SHA-256 `17284b6e8e33099e5c8deb93154f82d39923e914598233fcf6c2a23e7d37365c`. The original wrapper remains exit 1. Separate postflight passed all 20 source-discovered actor methods with zero skips, strict signing, exact source/artifact checks, and unchanged sealing. Reviewed generated outputs were retained outside source, not deleted. Owner Package.resolved remained exact.

App ready receipt: `/private/tmp/texttext-private-mac-app-c84e1927-20261019/private-actor-ready.json`. Build-receipt SHA-256 `f4c5146d086a29a43ed8de8ef0dc4849d682e610d972a1c5fbc7f347b580c470`; seal SHA-256 `1ff13e39ae48e089eabdfcfff1f7703e6b6cfa9e773255e2eaabb6792c073d4e`. Actual private bundle is 0.204/1270.

Both unchanged standard driver wrappers exited 0 and sealed. Three-role paths, hashes, and artifacts: `/private/tmp/texttext-private-mac-c84-final-artifact-manifest-20261019.json`, SHA-256 `77ece549f1152a9c20694ce7db6594c73437d96572288251f055c199ace64479`.

## Read-only native runtime

Normal app absence was checked before launch. Fresh owned AppGroup session used the genuine protocol: hello, prepare, two observe calls with `expectedEditIds: []` and `documentSnapshot: true`, then shutdown. Exact source/seal/principal attested; actual WebKit was `22625.1.29.11.28`. Both complete snapshots matched the owned article, including omitted subtitle; editor session stayed identical with zero reloads. The real JPEG stayed 53,704 bytes, SHA-256 `ed06a94f6b494148666ddcc13727aa3912aa8b750dab26da7d3f50fa620c6baf`; owner record bytes stayed unchanged. Shutdown acknowledged true, relay exited 0, and no TextText processes remained. No edits or close probe were requested.

Result: `/Users/shokunin/Library/Group Containers/52WM463HR2.group.app.texttext/NativeBootstrapC84-lxs7ktjw/result.json`, SHA-256 `0c73acbbb924bcad9963ac33e5aeac38701ac48d35fa5694125eb6b35b418704`. All session/config/replies are retained. A preceding harness ZIP-path typo failed before actor launch; the original script is preserved at `/private/tmp/texttext-mac-native-bootstrap-readonly-c84-20261019.py`, corrected create-only script has `-second-` in its filename.

The observed server was `texttext-oracle-20261019T021551274Z-4eca8353-1c86ff`, not a041 or c84. Browser/file readiness and the six-client campaign remain separate. Earlier failed a041 runtime and its exact snapshot/JPEG postproof remain documented in [reader-action evidence](2026-10-19-mac-private-reader-action.md).
