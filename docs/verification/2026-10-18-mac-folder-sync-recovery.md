# Mac pending folder sync recovery

## Scope

Adds recovery for the immutable owner-only case-change command introduced in `d59e63a6`. HTTP 409 remains advisory: it does not establish that the server operation was uncommitted. Existing user folders and installed apps were not used.

## Behavior

- Readonly pending command inspection does not wait for the background sync gate. Native root/account/schema checks run before the bounded server inspection and again after it. Transport or response failures produce an explicit unavailable row, retaining the original command.
- The common row contains all fourteen keys, with explicit nulls. Completed operations carry their strict moved receipt only in `result`; unavailable operations cannot be resolved.
- Resolution requires explicit bridge consent, fresh server request/inspection hashes, and the current local tree digest. The connection, account and selected root are checked across awaited calls.
- A completed receipt uses the existing whole-tree adoption path. Cancellation requires a durable server cancellation tombstone. Its immutable native receipt and containing directory are synchronized before pending state is cleared. Cancellation never renames or deletes synchronized files.
- Automatic requests are bounded before profile migration or durable queueing: native UUID, at most 20,000 folders/items, 256 UTF-16 units for folder paths, 1,024 for item paths, and at most 4 MiB minus 1 KiB of serialized command bytes. Replay and recovery preserve an unsendable command instead of publishing it.

## Verification

Final gate `/private/tmp/texttext-mac-folder-recovery-final-20261018.log`: Store-edition Swift test with `TEXTTEXT_STRESS_ACTOR`, **140 tests executed, two existing optional Shared skips, zero failures**. This includes FolderCaseSync 12, FolderCaseHTTP 3, FolderPropagationProfile 3, Sync 55, Shared 58, MirrorQueue 5, real local HTTP contract 2, existing WK folder bridge 1, and new WK folder-sync recovery bridge 1. All eight owned code files had identical SHA-256 hashes before and after the gate. Package.resolved was restored byte-for-byte.

The actual WK bridge fixture uses the packaged production mirror-policy host, a real native connection and an owned loopback HTTP directory server. It creates a retained command through a genuine server manifest-CAS conflict, inspects all fourteen row keys, rejects stale workspace scope and missing consent, signs out, reopens the window, and cancels with a durable native receipt while retaining `CASE/Empty` without recreating `Case`. Fixture authentication/metadata authority is synthetic; this is not live authenticated or six-client acceptance.

The sign-out assertion first exposed the handler accepting two absent credentials as a matching account: `/private/tmp/texttext-mac-folder-recovery-signout-red-20261018.log`. The handler now requires a captured verified account and matching current account before and after await. `/private/tmp/texttext-mac-folder-recovery-signout-green-20261018.log` and the final gate pass.

Other new coverage includes unavailable inspection, stale local consent refusal before cancellation, cancellation retaining pack bytes, post-cancellation scope revocation followed by fresh-engine tombstone recovery, lost-ACK completed receipt adoption without cancellation, readonly recovery while the ordinary move RPC is held, mismatched receipt refusal, request-size limits, and exact inspect/cancel HTTP shapes with bounded inspection timeout. Parent-owned real local HTTP tests additionally cover two native roots, whole folders with empty descendants, lost replies/restart, incoming case propagation and idle traffic counts.

Source pins: `/private/tmp/texttext-mac-folder-recovery-source-20261018.json`.

## Remaining work

Live authenticated cross-platform folder propagation/recovery and the final six-client campaign remain separate acceptance work. The per-checkpoint directory-identity scan remains a known scaling risk; optimize only after the functional recovery checkpoint, preserving the global pending-command fence and complete affected-tree proof.
