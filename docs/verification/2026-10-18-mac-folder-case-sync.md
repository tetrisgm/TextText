# Mac folder case sync: initial native integration

T13 initial integration of the [owner-only server lane](2026-10-18-server-folder-case-propagation.md). Recovery inspection/cancellation UI is separate required work; this is not final feature acceptance.

## Behavior

The HTTP transport accepts the advertised raw `manifestRevision` and `syncCapabilities:["folder-case-moves-v1"]` only with an account-bound full-access authoritative folder catalog. Existing transports default to no support. Actual POST requests carry the immutable agreed command and reject unknown receipt fields.

The sync actor records a root/account-bound physical directory identity baseline and complete catalog under protected profile-v3. A changed exact spelling must preserve the original directory device/inode and exact whole subtree, including empty folders and same-ID packs. It saves the original command before folder creation, binary/lifecycle handling, queue replay or per-file operations. Existing affected immutable outbox entries refuse this lane; they are never rewritten. Current server item revisions may be refreshed only when the full original topology still matches.

A pending existing shared journal does not prevent folder propagation. Until the folder receipt is accepted, new shared joins and checkpoint materialization refuse so the editor retains its draft for retry and cannot emit a clean local ACK. A valid receipt is checked against the exact operation, paths, original item revisions and complete subtree. The entire local tree and account scope are rechecked after the await. Only then are existing checkpoint/session/baseline paths rebased; pending update/batch, epoch, sequence and generation remain unchanged. The helper does not rename or recreate synchronized directories after observing an external rename.

Lost replies and even HTTP409 after server publication retain the same command and permit immutable retry. A conflict flag is advisory evidence, not proof that the server did not commit. No local cancellation is inferred from an HTTP status.

## Gate

`swift test --package-path mac --jobs 2 -Xswiftc -DTEXTTEXT_STRESS_ACTOR --filter 'LocalVaultFolderCaseSyncTests|LocalVaultFolderCaseHTTPTests|FolderPropagationProfileTests'`

130 checks pass (2 existing optional skips), including 7 real-filesystem actor fixtures, 2 actual URLSession transport fixtures, existing 3 profile-v3 fixtures, and the existing Sync/Shared/Queue classes: `/private/tmp/texttext-mac-folder-case-incoming-20261018.log` (runtime13.7s). The earlier focused10 gate also passed at `/private/tmp/texttext-mac-folder-case-integration-focused-second-20261018.log`. The exact Package.resolved bytes were restored after the gate. Exact five new/edited integration source pins: `/private/tmp/texttext-mac-folder-case-initial-source-20261018.json`; the root-owned profile files were unchanged by this worker.

Advertised unbaselined folded peers refuse only when the catalog path was retained as an original managed folder or baseline ancestor. A fresh incoming server spelling is not misclassified as an outgoing move; an explicit advertised incoming case fixture passes. Physical peer detection includes case-sensitive filesystems and never infers a rename from item paths. Baseline capture clears/skips while existing item paths have not yet settled, then retries after the pass. Unsupported legacy transports retain their prior behavior.

Cases: whole tree/empty descendants, actual external rename, empty-only move, lost reply across a new actor, committed409 followed by exact receipt replay, pending shared journal and batch preservation with generation7, new-join/clean-ACK fence during held RPC, and changed local membership during await retaining the command and foreign file. Transport fixtures verify real endpoint/body/account headers, capability downgrade and future receipt refusal.

The first run caught a directory-helper misuse of the TextPack-only URL validator and URLProtocol fixture body-stream handling. Both were corrected; the production validator was not weakened. A compile missing-await issue was corrected by explicitly asynchronous transport context dispatch and verified by the HTTP fixtures.

## Remaining scope

Shared recovery rows/inspection/cancellation, wider full existing native suites, real HTTP server/native integration, installed apps and six-client convergence remain separate. Initial fixtures use controlled transport responses, not a real server or remote authentication. No power-loss or arbitrary filesystem race atomicity claim. Preserve command/state and files on refusal; do not discard a pending operation or rename directories automatically to bypass it.

Performance follow-up: the initial checkpoint/join guard examines all recorded directory identities. Scope observation to the active path ancestors plus the global pending-command fence before sustained acceptance; no claim that this initial implementation is suitable for per-keystroke checks over a 20,000-folder vault.
