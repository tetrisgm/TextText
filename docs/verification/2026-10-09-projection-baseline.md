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
review findings. No deployment or new client installation yet.
The already-conflicted legacy Windows upload requires separately attested
recovery; this patch does not fabricate historical provenance. Six physical
clients, restart/reconnect acceptance and remaining product work are not certified
by these unit/native results.
