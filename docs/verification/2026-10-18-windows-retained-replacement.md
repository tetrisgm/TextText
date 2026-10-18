# Windows retained replacement integration

Status: source integration verified on the actual PC. Installed applications and public releases were not changed. This does not close the remaining T12–T17 acceptance or delivery gates.

## Behavior

- Existing-file writes stage immutable prepared bytes and a separate replacement, flush their contents, then use `File.Replace` with an actual displaced-file backup. No overwrite fallback, automatic cleanup, or rollback occurs. Pending/conflict/completed manifests classify observed target and retained bytes after success, failure, or interruption. Later writes through an old displaced descriptor reopen the fence.
- New document replacements live below `.texttext/retained-replacements/<original-relative-path hash>/`, on the target's verified volume. A strict root-relative registry `recoveryPath` binds the operation directory, filename hash, and UUID. Earlier same-parent records remain supported. Keeping historical inodes out of managed content folders allows an emptied old folder to be pruned.
- Registry entries bind stable item identity, root, and semantic account ownership. Ordinary reads, writes, receipt replay, shared checkpoints, upload and acknowledgment boundaries refuse unresolved work. Unrelated items continue syncing; saving sync state cannot advance a fenced item's baseline, queue, or binary state.
- Owned profiles preserve the original owner record and publish an attested owner format version two. Actual displaced ownership is retained and checked; a final publication race refuses without destroying the newer principal record. Existing factories verify the attestation. Unowned local folders acquire no invented principal. Explicit account adoption archives exact before/after registry bytes and binds only validated unowned or already matching entries.
- Recovery inspection is read-only. Explicit Keep current exports exact alternatives before acknowledgment, rechecks observed hashes, and preserves resolved rows for later downloads. Valid displaced files may have another identity; malformed displaced bytes remain downloadable as opaque data. Current/prepared identity checks remain strict.
- Native recovery requests bind the captured root, workspace, account, and bridge lifetime. Windows transport combines local recovery with hosted history; offline server history produces a visible warning while verified local versions remain available.
- Submitted attachment recovery retains raw bytes and an immutable operation provenance sidecar before retiring a binary operation. Listing bounds are 200 files, 16 MiB per asset, and 64 MiB of raw bytes. Invalid provenance is reported per entry without inventing an origin; exact raw downloads remain available.
- Preflight requires `2 * candidate bytes + 64 MiB` free space. No automatic deletion is installed. There is no lifetime record-count refusal. The Windows per-item index uses directory identity and change metadata for membership, then revalidates selected record stamps, schema, root, principal and recovery artifacts. Cache size bounds evict cached data without refusing retained records. Portable runs use full scans.

## Verification

Final actual-PC source archive SHA-256:

`a011bae1e6f404257c80f28ba10d5ce8e0b525ab23af5d711179d5766e888b08`

The archive and per-file content hashes are recorded in `/private/tmp/texttext-t12-retained-actual-pc-source.json`. The mutable private test checkout was `C:\Users\Shokunin\dev\texttext-delivery-65417abd`.

| Check | Result | Receipt |
| --- | --- | --- |
| Actual Windows full Core gate | 750 passing assertions | `/private/tmp/texttext-t12-retained-actual-pc-core.log` |
| Actual Windows bridge gate | 45 passing checks | `/private/tmp/texttext-t12-retained-actual-pc-bridge.log` |
| Portable full Core gate before final workspace-staging correction | Passed | `/private/tmp/texttext-t12-windows-portable-core-final.log` |
| Focused Windows transport tests | 23 passed | `/private/tmp/texttext-t12-windows-transport-final.log` |
| TypeScript check | Passed | `/private/tmp/texttext-t12-windows-tscheck.log` |

The subsequent consent cancellation change runs the captured root/account/lifetime check after exporting and revalidating both alternatives, immediately before writing acknowledgment. Its targeted follow-up passed 97 assertions on the Mac, 103 on the actual PC, and all 45 bridge checks on each machine. Cancellation leaves exports intact and consent unresolved. The 750/45 snapshot remains the full-suite baseline for unchanged scenarios.

Follow-up source patch SHA-256: `4e5781d3d642b8ea1a3620a324e7fb51f82cc167964f81d1c83a2c67b8044acb`, applied to the full baseline above. Receipts:

- `/private/tmp/texttext-t12-retained-actual-pc-cancel-source.json`
- `/private/tmp/texttext-t12-retained-actual-pc-cancel-core.log`
- `/private/tmp/texttext-t12-retained-actual-pc-cancel-bridge.log`
- `/private/tmp/texttext-t12-windows-focused-cancel-mac.log`
- `/private/tmp/texttext-t12-windows-bridge-cancel-mac.log`

The final profile guard follow-up also refuses a published malformed or future profile while ownership is still version one, including already-open stores with no registry entries. A preserved-owner-only directory without a published marker still permits forward migration. This passed 100 focused Core assertions on the Mac, 106 on the actual PC, and 45 bridge checks on each. Its four-file patch SHA-256 is `7e874456cf040683d9e041329303e73963e2463ba35201d47b1663d31f8223a7`, applied after the cancellation patch. Exact hashes and receipts are `/private/tmp/texttext-t12-retained-actual-pc-profile-one-source.json`, `/private/tmp/texttext-t12-retained-actual-pc-profile-one-core.log`, `/private/tmp/texttext-t12-retained-actual-pc-profile-one-bridge.log`, `/private/tmp/texttext-t12-windows-profile-one-mac.log`, and `/private/tmp/texttext-t12-windows-profile-one-bridge-mac.log`.

Coverage includes actual Windows replacement success, final-check external races, an old writable descriptor, interrupted classification, malformed/future manifests, raw rename, completed file/folder moves followed by saving, explicit recovery followed by saving, persistent resolved rows, principal publication races, explicit account adoption restart/refusal, changed request scopes, binary provenance corruption, and a replacement conflict arising during upload without acknowledging the original outbox operation.

The first actual-PC broad snapshot failed the queued-upload folder-pruning assertion because same-parent retained directories occupied the old folder. Workspace-root staging fixed this; the final full gate passed. The separate bridge test fixture initially timed out because it omitted the mandatory policy host. It now supplies the existing test-only source host; production policy requirements are unchanged.

## Registry performance follow-up

The private registry publication contract requires atomic record publication. Directory generation changes rebuild identity membership; selected records always undergo file-identity/change-time and scope checks. Unknown identities prevent indexing. Arbitrary external in-place reassignment of an unrelated private record to another item identity is outside this contract and can evade membership invalidation until a directory generation change. No filesystem watcher is trusted. A portable and actual-PC fixture exercises 4100 retained records without a lifetime refusal, selected in-place future-schema edits, cross-instance atomic publication, and unidentified records.

Before indexing, the actual-PC 1000-document fixture measured 2044.7 ms first read, 8442.2 ms one save, and 2263.6 ms next read. A 1000-operation same-item history measured 10562.1 ms, 39922.1 ms, and 10288.6 ms respectively. Fixture creation (55.4 s and 54.6 s) is excluded. The benchmark retains its scratch data and records exact paths in `/private/tmp/texttext-registry-benchmark-before.log`.

Indexed actual-PC results were 496.2 ms / 574.7 ms / 14.8 ms for 1000 documents, and 9819.8 ms / 28336.0 ms / 6661.1 ms for 1000 same-item operations (first read / one save / next read). Setup was 57.8 s / 52.1 s and is excluded. The index improves document breadth; the same-item history remains too slow for acceptance and requires a separate manifest/artifact hot-path optimization. No retained bytes were removed.

The indexed full gates passed 749 portable Core assertions, 761 actual-PC Core assertions, and 45 bridge checks on each machine. This source archive is `01c9057b797929d31f51236b83e41deeca250456e1006467b1d3b0774190ac93`; per-file hashes are `/private/tmp/texttext-t12-registry-index-source.json`. Actual-PC logs are `/private/tmp/texttext-t12-registry-index-core.log`, `/private/tmp/texttext-t12-registry-index-bridge.log`, and `/private/tmp/texttext-t12-registry-benchmark-after.log`. Portable logs are `/private/tmp/texttext-t12-registry-index-full-mac.log` and `/private/tmp/texttext-t12-registry-index-bridge-mac.log`.

A final targeted regression demonstrated that duplicate-path validation could skip a second operation's mismatched `recoveryPath`; the deterministic fixture failed before adding operation identity to the validation cache key. The fix passed 106 focused portable assertions, 112 actual-PC assertions, and 45 bridge checks on both machines. Patch SHA-256 `4fd8d412bd114107919e722afbd63edda559fc0cc31c12f48f010c8b5d291e76` follows the indexed full-gate source. Exact hashes and targeted logs: `/private/tmp/texttext-t12-registry-index-final-source.json`, `/private/tmp/texttext-t12-registry-index-final-core.log`, `/private/tmp/texttext-t12-registry-index-final-bridge.log`, `/private/tmp/texttext-t12-registry-index-final-focused-mac.log`, and `/private/tmp/texttext-t12-registry-index-final-bridge-mac.log`. The benchmark applies to the preceding source; its normal-case paths are unchanged by this validation-key correction.

## Evidence limits

Windows directory-entry persistence under sudden power loss remains unproven. `REPLACEFILE_WRITE_THROUGH` is unsupported; staged file contents are explicitly flushed. Unsupported filesystem or volume checks refuse without replacing the document. Retention grows with successful saves. The known prior owner-version-one factory guard is characterized in fixtures; a full historical-binary/client compatibility campaign remains separate. Final installed UI, sustained performance, multi-client convergence, and soak acceptance remain open.

Microsoft primitive contract: [ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew).
