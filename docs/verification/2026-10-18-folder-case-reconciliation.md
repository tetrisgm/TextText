# Folder case reconciliation

## Contract

Authoritative folder catalogs reconcile existing directory component spelling without changing document identities, archive bytes, shared session tokens or pending editing journals. The whole requested catalog is checked for contradictory spellings of the same directory inode before mutation. Existing non-directory collisions remain per-folder errors so independent entries can continue. Retired catalog paths are pruned only when every component has the exact retired spelling; a case-insensitive alias cannot remove the current directory.

Shared editing and sync now test every relative path component. An already renamed containing directory therefore follows the existing external-move adoption path rather than attempting a second child rename. Active editing and closed pending checkpoints preserve their hashes, pending state and new relative path.

Directory case mutation requires the existing verified account owner. Local-only/unowned roots retain ordinary creation and exact existing paths, but refuse case mutation before an intent or filesystem mutation with the existing account-review error. This is an explicit compatibility limit, not implicit account adoption.

## Durable operation and recovery

Device-private `folder-case-renames` records bind an operation UUID, canonical root, semantic account principal, exact source/destination paths, original directory identity and parent identity. The root-private lease excludes an active rename from pending-intent cancellation or explicit consent. Unknown fields, future versions, unsafe paths and foreign principals refuse without clearing records.

The operation records its intent durably before an exclusive, nofollow, parent-FD-anchored rename. On Darwin, an open source-directory descriptor does **not** prevent a source leaf swap, and `renameatx_np` has no expected-inode parameter. A foreign directory can consequently be moved by that final race; its visible contents remain at the destination, and the original directory remains wherever the external writer moved it. Post-rename identity classification records a conflict and fences retries. There is no blind rollback, overwrite, directory deletion or claim of a retained directory copy. The disposable OS characterization is `/private/tmp/texttext-folder-case-fd-probe-20261018.json`. Windows uses a separate source-handle primitive; the Darwin receipt does not claim its source pinning guarantee.

Restart classifies an unchanged original exact path as an unperformed cancellation, and the original inode at the exact new path as completion. Foreign/missing/ambiguous observations remain fenced. An unresolved folder record conservatively blocks ordinary workspace reads, writes and acknowledgments globally; this initial implementation does not claim unrelated writes can proceed.

Recovery lists and reads bypass that normal fence while checking the original root, owner and profile. The bridge lists folder recovery first, leaving other recovery arrays empty until the folder review is resolved. Inspection describes the two current endpoint identities/presence and bounded descendant metadata, not document snapshots or copied bytes. It is limited to 10,000 entries and 4 MiB of metadata; symbolic links, unreadable paths or truncation block confirmation. The inspection digest covers sorted path/type/identity/size/time metadata and endpoint observations. It does not search the rest of the workspace for the old inode or attest file content hashes.

Explicit Keep current folder paths repeats inspection and a pure captured account/root/connection authority check, then stores consent without moving or deleting anything. Tests reject a filesystem mutation during confirmation and scope rejection after inspection. Arbitrary external filesystem writes are not globally locked; this is a checked metadata snapshot, not an atomic transaction across an external writer and account UI. Resolved records remain inspectable and allow later legitimate directory renames and descendant edits.

## Supported prior reader floor

Before the first owned directory mutation, the existing retained-replacement profile marker advances from version 1 to version 2. The owner remains version 2 and its semantic principal hash stays unchanged. Exact marker-v1 bytes are preserved in create-only `profile-v1.json`; the existing retained exchange preserves the actual displaced marker and handles interrupted publication. New readers accept supported marker versions 1 and 2; the prior supported marker reader requires version 1 and refuses the new floor. Tests cover both pre-swap and post-swap interruption/restart. Raw filesystem tools and already running old processes are external writers; this is not a retroactive guarantee for arbitrary old readers.

## Verification

The original three fixtures reproduced five failures: empty authoritative catalog case changes could remove the live alias, contradictory catalogs could mutate an unrelated folder first, and active shared editing retained the old parent spelling. RED log: `/private/tmp/texttext-folder-case-red-20261018.log`.

Initial focused verification passed six folder helper cases, the original three cases, eleven profile cases, and three actual WK retained-window lifecycle cases. Log: `/private/tmp/texttext-folder-case-focused-second-20261018.log`.

The final broad exact-source native gate passed 53 app tests (three opt-in skips), two real offline-window tests, 254 FileProvider tests (six opt-in skips), and 73 CLI tests, including the unchanged legacy write fixtures. Folder helper coverage includes final-gap foreign directory preservation, lost replies, restart classification, live-capture exclusion, unowned refusal, blocked symlinks, foreign regular endpoints, unknown formats, explicit consent and later legitimate renames. The packaged WK policy ran with an explicit fixture bundle. Log: `/private/tmp/texttext-folder-case-native-full-final-20261018.log`. Twelve affected native source hashes matched before and after in the corresponding `.source-before.json` and `.source-after.json` files. Exact original `mac/Package.resolved` bytes were restored.

A separate actual WK bridge fixture passed against the same product source. It creates a real retained folder conflict, proves normal recovery guards are fenced, then exercises the production message handler: folder-first Recovery succeeds, the ten-field row preserves null endpoints, other recovery arrays stay empty, a stale workspace root refuses, and a fresh inspection succeeds. Log: `/private/tmp/texttext-folder-case-wk-bridge-20261018.log`. The twelve broad-gate source hashes still matched; the added bridge test hash is included in `/private/tmp/texttext-folder-case-checkpoint-20261018-source.json`.

Installed Mac/PC/provider acceptance remains pending. This receipt does not claim power-loss certification or delivery to the installed application.
