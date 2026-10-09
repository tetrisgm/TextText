# TextPack projection baseline repair

## Reproduced failure

An offline app save writes coherent JSON and Markdown. A later CLI edit changes
Markdown alone. Comparing both representations with the last cloud snapshot
misclassifies those sequential edits as competing changes. This prevented the
Windows full1235 fixture from joining collaboration after its draft was saved.
See [installed 1236 evidence](2026-10-08-client-1236.md).

## Implementation

`net.texttext.projection.json` records the validated last coherent document and
SHA-256 digests of its JSON and Markdown entries. Coherent writers stamp it.
Readers use it to attribute JSON-only and Markdown-only edits, including
intentional deletion. Concurrent representation edits reconcile against that
baseline; a proved conflict cannot fall through to an unrelated cloud base.
Legacy ambiguous packs remain preserved without inventing an edit order.

The shared pack builders, local reader, native bridge, Mac checkpoints and CLI
writers participate. Windows writes packs from the shared builder. The baseline
is derived reconciliation metadata and does not reset the collaboration epoch.
Hashing uses pinned `@noble/hashes` 2.4.0. Native and shared validators run the same
25-case coherence fixture, covering note/article/bookmark/gallery/talk metadata.

## Verification before delivery

- Implementation worker: 272 tests across 15 affected shared suites; TypeScript
  and touched-file lint passed.
- Independent parent rerun: 32 projection and local-reader tests passed;
  `/tmp/texttext-projection-final-parent.log`.
- Mac FileProviderKit: 210 tests, one skipped, zero failures; CLI: 122 tests,
  zero failures. Logs: `/tmp/texttext-projection-finalize-mac-fpk.log` and
  `/tmp/texttext-projection-finalize-mac-targets.log`.
- Browser local-vault bundle compiled. Build-script tests: two passed. Isolated
  browser-platform hash bundle returned the known SHA-256 vector without Node.
- Implementation reports: `/tmp/texttext-projection-implementation.md`,
  `/tmp/texttext-projection-followup.md`, `/tmp/texttext-projection-finalize.md`.

## Outstanding

Focused review found a Swift numeric-conversion trap. The fix keeps finite
cover heights as rounded doubles, with three shared extreme-value regressions.
The 18 shared projection tests and native projection suite pass after the fix;
logs: `/tmp/texttext-projection-overflow-{ts,swift}.log`. No other material
review findings. Mac 0.204 build 1237 and Windows are installed from `6d07ca4b`;
Oracle serves the same source.
The already-conflicted legacy Windows upload requires separately attested
recovery; this patch does not fabricate historical provenance. Six physical
clients, restart/reconnect acceptance and remaining product work are not certified
by these unit/native results.

## Installed Mac acceptance

The clean archive at `/private/tmp/texttext-delivery-6d07ca4b` passed 875 core
tests and produced the signed arm64 app with three extensions. Initial packaging
lacked cached App Intents metadata; the successful retry is recorded in
`/tmp/texttext-mac1237-build.log`. Installation used the established local Store
workflow (`/tmp/texttext-mac1237-install.log`), preserving the previous app.

Live UI: signed-in account and iCloud workspace retained, existing full1235 note
opened without recovery UI. Appended `[mac-app:installed1237:00]`, finished editing,
searched the exact title with Command-K and reopened it. The saved TextPack
contains the marker exactly once and its baseline matches both JSON and Markdown
SHA-256 digests. Left the app in reader mode. This is single-client acceptance,
not a six-client convergence result.

## Windows and Oracle delivery

Windows candidate `candidate-ce255e99bb284c878f445dfeba3214e3` passed native
core/agent suites, 365 shared client tests, TypeScript and interactive packaging
smoke. The canonical installation verified after replacement, preserving the
previous app and user profile. Its process responded after startup; this is not
editor acceptance.

Oracle now serves `texttext-oracle-20261009T073910Z-6d07ca4b`. Exact-source gates
passed 4,854 tests (154 skipped), database suites, 875 shared sync tests and native
suites. Packaging passed after replacing the archive's external node_modules
symlink with a clone copy. Deployment created a fresh database backup and passed
13 authenticated live checks. Previous release retained; Algorave and HAProxy
unchanged. Receipts: `/tmp/texttext-delivery-6d07ca4b.md`,
`/tmp/texttext-installed-6d07ca4b.md`, `/tmp/texttext-oracle-deploy-6d07ca4b.log`.

Acceptance runner commit `c3cbf9ce` requires matching shared-document readiness
before browser input. Nine runtime/readiness tests pass and run in Windows builds.
Fresh fixture `Six-client acceptance full1237` is saved through the Mac app;
simultaneous acceptance and retained legacy-upload recovery remain pending.
