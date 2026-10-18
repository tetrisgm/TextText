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
- Preflight requires `2 * candidate bytes + 64 MiB` free space. No automatic deletion is installed. The initial registry enumerator still refuses beyond 4096 records; removing that effective refusal through the reviewed index is required before claiming the agreed policy with no lifetime count cap.

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

## Evidence limits

Windows directory-entry persistence under sudden power loss remains unproven. `REPLACEFILE_WRITE_THROUGH` is unsupported; staged file contents are explicitly flushed. Unsupported filesystem or volume checks refuse without replacing the document. Retention grows with successful saves. The known prior owner-version-one factory guard is characterized in fixtures; a full historical-binary/client compatibility campaign remains separate. Final installed UI, sustained performance, multi-client convergence, and soak acceptance remain open.

Microsoft primitive contract: [ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew).
