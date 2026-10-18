# Coherent candidate build, October 18

## Identity and scope

T03/T21/T26 preparation uses commit `f994b8f1eee9ff6615856916f180001dc23a00ba` (F). Full pristine source proof before and after builds: `3ba408e5404e86c18405e3cc068ab93b34d94a4a8762b8d0e1afe7bcce95c49c`, 3,082 files. Archive SHA-256: `ed01c5a974dd2dd6f93ff38c472d4c7ece91b40e12a20832eba2c0afc0a024a5`. Unrelated owner changes were excluded and preserved. These are build receipts, not installed or six-client acceptance.

## Mac normal candidate

Actual `npm run verify:release` passed all **22 checks** in 457,056 ms. Web: **5,134 passed, 161 optional skipped**; database: **123 tests across 29 files plus four scale checks**; native unit checks passed. Separate `node sync/verify.mjs` passed. Private actor source tests passed five checks. Genuine workflow-capability and build attestations preceded the Store-local build.

Normal signed app: **0.204 (1263)**. Strict signing, arm64 app and three extensions, and actual isolated AppHealth **18 checks passed**, exit zero. Executable SHA-256: `970aaf93e898288adf467764dfe14196d2f50e1f8e87e0ec008097bbaba6001a`.

Private evidence: `/private/tmp/texttext-final-local-store-1263-f994b8f1-20261018/normal-local-build-receipt.json`, adjacent `Normal-TextText.app`, and `/private/tmp/texttext-final-local-candidate-1263-f994b8f1.log`. Genuine release receipt SHA-256: `bc5d02415fc536aa91b237e2c076b176b7c559607bb4459d5cff16126097964d`.

Python bytecode generation was disabled before children began. Only the two proven generated outputs, `next-env.d.ts` and `tsconfig.tsbuildinfo`, were retained outside the archive by reversible same-volume rename after compilation. Their receipt preserves hashes and file identities. Unchanged strict source proof and release-receipt checks passed afterward. Unknown source inputs were not ignored.

## Windows normal candidate and private actor

The actual PC built F from a verified Git bundle using an owned private bare object store. Only that store has `core.autocrlf=false`; global Git configuration was preserved. The initial CRLF bootstrap refusal remains recorded rather than counted as success.

Official normal build passed **1,089 Core, 100 actual Windows bridge, 12 agent, and 520 shared assertions**, TypeScript, UI build/publish and actual desktop/editor/close smoke. The official candidate seal was checked twice; 428 artifacts and full source proof remained unchanged. Candidate directory ends `candidate-3f89d7fb5e0a4c899087c6d79ef28593`. Normal result SHA-256: `a6b3447b492ef7825cbe3eb68ed95a074bc314ccd5bfcb984a239ee77b2134f6`.

Separate private actor DLL SHA-256: `af26209cc2ed3f1884a5017ed14dd98f1aeb518a6e7d881df63c9d46fa286b4e`; sidecar: `67d765aaf62d3d0d18c28885cd21ce243ead2aca0cb6bc7f31675b3b175a2a26`. Local private evidence: `/private/tmp/texttext-pc-frozen-f994b8f1-9chy9n57`. Neither candidate installation nor physical actor execution is claimed here.

## Release CLI delivered

Actual Store release CLI build passed with unchanged source and normal app. Strict-signed arm64 artifact SHA-256: `255f85497755c8e365d6564b2d4152e5a3c0c5c2048a4f7900bdd214f214cb32`. The existing `~/.local/bin/texttext` symlink now targets the create-only `~/.local/share/texttext-cli/source-f994b8f1/texttext`; its prior `source-ffbc83ee` binary remains intact. Hash, signature and `--help` passed before and after the atomic symlink replacement. `--version` is unsupported and was not used as identity proof. No account/auth/profile/content changes occurred.

Build evidence: `/private/tmp/texttext-release-cli-f994b8f1-20261018/release-cli-receipt.json`; delivery evidence: `install-receipt.json` and `install-verification.json` beside the installed executable.

## Next acceptance and recovery

The old installed Mac app quit normally through Cmd-Q; exact PID 14018 disappeared, without force quit or a Keep editing dialog. Its actual private state still requires complete backup and supported saved-work review, including retained journals; zero sync outbox does not prove all shared drafts clean. Windows has one pending operation in its actual binding state, which must also be preserved. New profile formats prohibit launching historical binaries against upgraded roots.

At this checkpoint the normal Mac and Windows apps and Oracle have not been updated. Next: verified private backups, standard Oracle web-only delivery with backup/migration/health/authenticated smoke, official normal installs, supported account review, installed ordinary-use checks, current six-client readiness and independent reopen. T20/T22–T25 remain open; this build pass does not close them. Earlier failed candidates and their evidence remain preserved: [documentation gate](2026-10-18-pristine-documentation-gate.md), [account-link race](2026-10-18-account-link-provider-race.md).
