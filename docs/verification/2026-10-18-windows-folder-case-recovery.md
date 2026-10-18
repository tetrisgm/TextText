# Windows authoritative folder-operation recovery

## Contract

Adds scoped `files.folderSyncMoveList`, `files.folderSyncMoveRead`, and `files.resolveFolderSyncMove` bridge methods using the [shared protocol](../sync/folder-case-moves-v1.md). Every row has fourteen required keys, with explicit nullable server fields. A completed receipt is not relabeled as an entire workspace catalog.

Pending immutable commands remain inspectable when ordinary sync is stalled. Server inspection is bounded to two seconds, including a transport that ignores cancellation. Offline or malformed responses produce an explicitly `unavailable` row, retaining local command/metadata proof and disabling resolution. Native account/profile/schema failures still refuse.

Resolution binds the exact operation, opaque authenticated server request hash, fresh server inspection, and fresh local metadata digest. It checks captured root/account scope around awaits and before acknowledgement. Completed operations replay the original operation and use normal strict receipt adoption. A cancellation requires the server's durable tombstone proving the original command cannot later publish. Its exact command and server proof are retained create-only under device-private `folder-sync-cancellations/<UUID>.json` before clearing pending state. Interruption after proof persistence validates that receipt on retry. No recovery action moves, deletes, rolls back, or overwrites current local trees.

Wire preflight runs before profile publication or durable queue creation: UUID, at most 20,000 source folders/items, folder paths at most 256 characters, item paths at most 1,024 characters, and exact camelcase JSON at most 4 MiB minus 1,024 bytes for the recovery wrapper. A hypothetical oversized saved command remains retained and inspectable with a clear review error; replay does not send, clear, or rewrite it.

## Verification

Latest frozen twelve-file source archive SHA256:
`dbb237958811b350a8a31fc5019b7102c8fdc01c07887026158fafbcc48de461`.
Manifest: `/private/tmp/texttext-folder-recovery-full-source.json`.

Focused actual PC: **29 Core assertions and 100 bridge assertions passed**. Logs `/private/tmp/texttext-folder-recovery-latest-core.log` and `/private/tmp/texttext-folder-recovery-latest-bridge.log`. Latest full gates passed Mac **963 Core + 58 bridge** and actual PC **1,089 Core + 100 bridge**, all exit zero. Logs `/private/tmp/texttext-folder-recovery-{mac,full}-{core,bridge}.log`. Actual PC Core DLL SHA256 `127b36bb0cc0c7995b092e4501b9ab299f8394931120707b06e27fe3e476b11f`.

Cases cover exact HTTP union/endpoint/request binding, missing/future server fields, malformed topology, offline inventory, timeout despite ignored cancellation, listing behind a hung sync gate, stale local/server inspection, completed receipt forwarding, immutable cancellation proof before acknowledgement, interrupted forward recovery, all root/workspace/account scope refusals, mandatory consent, request cancellation, owner replacement after inspection and after server cancellation, exact fourteen-key bridge serialization, and unchanged current files/empty descendants. Preflight tests exercise item/path/body bounds and oversized saved-command preservation.

Intermediate full gates before the final wire-bound fix passed Mac **959 Core + 58 bridge**, actual PC **1,083 Core + 100 bridge**. These are retained under `/private/tmp/texttext-folder-recovery-{mac,full}-preflight-intermediate-*` and are not the final-source claim. One new bridge fixture initially used `await using` for the existing `IDisposable` bridge; compile red retained at `/private/tmp/texttext-folder-recovery-bridge-compile-red.log`, corrected to explicit awaited retirement.

## Limits

Local inspection records bounded directory metadata, not byte backups. Unsafe/unreadable/truncated inspection blocks consent. Ordinary file synchronization remains conservatively blocked if a cancelled local casing change still disagrees with the authoritative original catalog; restoring that original local spelling may be necessary.

Folder identity observation currently scans the retained folder baseline at readiness/join/checkpoint acknowledgement boundaries. Its large-catalog cost needs T25 measurement. These functional gates do not establish typing/close performance acceptance, a native install, server deployment, or a multiplayer campaign pass.
