# Windows retained removal

Status: the source slice passed portable Mac and actual-PC Core/bridge gates. No installed application or public release changed. Root ownership migration serialization, full application rebuild, and real typing/durable-close acceptance remain separate follow-ups; this does not close T13 or the full plan.

## Behavior

- Removal stages the exact expected pack, publishes a root/principal/item-bound pending record, then exclusively moves the actual visible inode into retained storage on the verified volume. A raced foreign or malformed inode remains retained. There is no unlink, overwrite fallback, or rollback.
- Pending, completed, conflict, and cancelled states reconstruct interrupted work. An unperformed removal cancels only after observing unchanged original bytes or one exact unambiguous relocated item; changed, missing, foreign, or duplicate observations remain fenced. An unperformed ambiguous operation remains pending so later exact restoration can recover safely.
- Capture and cancellation share a device-private operation lease in `StateDirectory/replacement-capture-leases/<UUID>.lock`. A second store cannot cancel active capture. Pure inspection creates no lease or consent.
- User deletion exports immutable per-operation Trash copies before publishing an operation-bound intent. Marker consumption records that exact operation's publication before removing its intent, closing marker-write/flag-write crash replay. Remote deletion retains the inode without inventing a local user intent. Restored items cancel stale unissued intents.
- Recovery observes the original pathname, including exact absence, foreign identity, or opaque bytes. Prepared and displaced bytes remain downloadable when another visible identity prevents resolution. Strict resolution refuses unsafe or incomplete scans; ordinary inventory-compatible scans skip unrelated linked entries without following them. The original pathname never treats a link as absence.
- Uncaptured recovery exposes `captured:false`, a null displaced hash, and an absent displaced snapshot. Explicit cancellation exports prepared/current bytes, rechecks presence and hashes under the operation lease, then persists consent before marking the helper cancelled. It never changes the current file. Cancelled requests retain exports without consent; interruption after the durable receipt completes on restart.
- Successful user-deletion rows remain available offline as read-only completed history. `resolved:true` can describe automatic completion, not only human recovery consent. Later retained-inode changes reopen the unresolved fence.

## Verification

| Gate | Result | Log |
| --- | --- | --- |
| Portable Mac full Core | 818 assertions passed | `/private/tmp/texttext-t13-removal-final-full-mac.log` |
| Portable Mac bridge | 51 checks passed | `/private/tmp/texttext-t13-removal-final2-bridge-mac.log` |
| Actual PC full Core | 833 assertions passed | `/private/tmp/texttext-t13-removal-final-core.log` |
| Actual PC bridge | 51 checks passed | `/private/tmp/texttext-t13-removal-final-bridge.log` |

The eleven-file source archive SHA-256 is `e9673ae8e013e8e05aec548f6e8cfe80b02fbcf867215f337b44b9100a5e3ba1`; the subsequent one-file scan correction is `b1991a142685bf542d21c4a958b028831943a7e4c3ebfebd2f47bb953901beb8`. Exact paths and per-file hashes are in `/private/tmp/texttext-t13-removal-source.json` and `/private/tmp/texttext-t13-removal-scan-fix-source.json`. Both include the root-owned bridge snapshot. The private PC checkout is `C:\Users\Shokunin\dev\texttext-delivery-65417abd`; its resulting Core DLL SHA-256 is `1378a4668bc5b7acb01080de2da0c6cef52d92ec06c9862304cdf9f283c0e3e1`.

The first full gates exposed an unrelated linked-folder regression: the new identity scan rejected a workspace entry that existing inventory intentionally excludes and preserves. The actual-PC red stdout is retained at `/private/tmp/texttext-t13-removal-unsafe-red-core.log` (395 passing assertions before refusal); the exception stack was also observed in the tool transcript. The scan correction preserves that scope while keeping strict cancellation scans fail-closed. Final full gates passed.

Coverage includes expected/foreign/opaque final-boundary races; actual Windows old-descriptor writes after capture; interrupted staging, capture and marker publication; independent acknowledgement before the publication flag; restoration followed by a new deletion; unchanged and ambiguous raw rename; active capture versus a second store; read-only inspection; explicit uncaptured cancellation, cancellation after export, and receipt-before-helper crash replay.

## Marker causality follow-up

A new source-present user deletion acknowledges a prior operation-bound deletion marker before capturing the new inode. An older unissued operation encountering another valid published marker verifies its root/principal/item/path/hash binding, exact completion or consented absence, retained bytes, and unchanged marker bytes. It records `supersededBy` and preserves the newer marker byte-for-byte. Restoration is rechecked under the publication lock; clearing matches the exact operation. Legacy, unbound, missing-operation, and unknown-field markers cannot be implicitly coalesced.

Full gates on this follow-up passed 835 portable Mac Core assertions, 850 actual-PC Core assertions, and 51 bridge checks on each machine. The focused portable gate passed 191 assertions. Tests cover old A paused before publication then valid B, restoration observed before same-byte B, ordinary native B, prior B restored then fresh A with same or changed bytes, exact new hash preservation, and consumed markers never resurrecting old operations.

The five-file follow-up source archive SHA-256 is `e9d348780052fa3f30e25b56769138d0dc2bf4b7d93bcb9de77a037d218eee3c`, based on checkpoint `d4b570f8`. Exact hashes are `/private/tmp/texttext-t13-causal-source.json`; logs are `/private/tmp/texttext-t13-causal-full-mac.log`, `/private/tmp/texttext-t13-causal-bridge-mac.log`, `/private/tmp/texttext-t13-causal-core.log`, and `/private/tmp/texttext-t13-causal-bridge.log`. Actual-PC Core DLL SHA-256: `aa1b3e30cb1378c5fc9552338e02dec2a76f76aab21be4441b9a8408f2d320eb`.

## Limits

Directory-entry persistence under sudden Windows power loss remains unproven. File contents and metadata records use explicit `Flush(true)` before publication. Retention grows without automatic deletion or a lifetime count cap. These tests do not prove concurrent root ownership migration, installed UI, historical-client compatibility, sustained convergence, or real typing and durable close.
