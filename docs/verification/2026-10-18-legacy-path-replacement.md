# Legacy TextPack retained replacement

## Compatibility contract

The broader Mac gate found five unchanged CLI tests failing writes to legacy TextPacks without an embedded `textTextId`. The retained-save path had required a document identity even though these files were already supported by the CLI. The fix preserves their Markdown, unknown ZIP entries, metadata and assets; it does not insert an ID or treat a filesystem writer as an authenticated agent.

Existing identity-based replacement remains the default. The explicit private registry discriminator `identityMode: "path"` permits only an identityless-to-identityless replacement at the bound original path, with `itemId: ""`. The operation UUID, workspace/owner binding, path and immutable hashes identify the retained operation. A transition between absent and real document identity still refuses.

Old registry readers reject the new field. New readers reject unknown modes and inconsistent mode/identity combinations without clearing state. This is private recovery metadata, not a new document schema or a portable identity. Wider mixed-version/rollback acceptance remains T17 work.

## Recovery contract

The original path is authoritative, including a foreign file or absence. Recovery exposes all three complete versions as opaque bytes; it does not substitute a matching document elsewhere. The shared UI offers exact downloads and explicit Keep current file or Keep path empty, retaining the captured workspace transport. It does not offer a parsed restore action for these raw snapshots.

Confirmation carries the exact mode, empty document ID, path, hashes and current presence. Native resolution must verify them against the registry, export complete copies, repeat filesystem and scope checks, and record consent without changing the visible file. Unidentified reads retain the existing unresolved-operation fence, including after a raw rename. An ID-only caller without a path also verifies retained path-mode history before acknowledgment, since it cannot prove that the unidentified operation is unrelated. A late writer can reopen that fence. Identified reads with an explicit different path remain scoped and can proceed.

## Verification

The focused native gate restored all 33 original CLI DocumentStoreTests and passed 41 registry tests (two opt-in benchmarks skipped). The same run exposed invalid queue-test fixtures; those separate fixtures are being corrected without changing production validation. Log: `/private/tmp/texttext-legacy-path-replacement-focused-20261018.log`.

A later exact-source run passed 42 registry tests (two opt-in benchmark skips), all 33 unchanged CLI DocumentStoreTests, and 23 RemoteDocumentStoreTests. Its newly staged queue fixture intentionally failed four assertions; this is not a whole-gate pass. Log: `/private/tmp/texttext-mac-new-staged-queue-red-20261018.log`. Current legacy source hashes and the unchanged original CLI test source are recorded in `/private/tmp/texttext-legacy-path-replacement-focused-20261018-source.json`.

New native cases cover exact plain Markdown without invented identity, all three raw versions, a foreign-ID current path that cannot bypass the fence, mode mismatch and revoked-scope refusal, retained copies before consent, honest absent original path after raw rename, lost replies and late retained-descriptor writes, unknown private modes, implicit adoption refusal, and conservative no-path acknowledgment versus explicitly scoped unrelated reads.

The complete shared recovery browser fixture passes with new raw-version downloads, empty-ID/mode echo, honest absent-current confirmation, and refusal of parsed or future-mode replies. TypeScript passes. Logs: `/private/tmp/texttext-legacy-path-recovery-browser-20261018.log` and `/private/tmp/texttext-legacy-path-recovery-typecheck-20261018.log`. Light/dark screenshots were inspected at `/private/tmp/texttext-legacy-path-recovery-{light,dark}.png`.

The final combined exact-source Mac gate passes 50 app tests (three opt-in skips), two real offline-window tests, 239 FileProvider tests (six opt-in skips), and 73 CLI tests, including the unchanged legacy write fixtures. The real packaged WK policy fixture ran. Log: `/private/tmp/texttext-legacy-queue-native-full-second-20261018.log`; 12 affected Swift source hashes were unchanged before and after at `/private/tmp/texttext-legacy-queue-native-full-second-20261018-source.json`. Installed acceptance remains pending. This receipt does not claim machine power-loss safety or current installed delivery.
