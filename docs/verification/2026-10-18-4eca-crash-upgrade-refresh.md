# Frozen 4eca crash and upgrade refresh

T16–T18 bounded verification refresh; no product or fixture source changed.

Both existing commands exited zero from the verified normal1269 archive at source `4eca8353f455d5960e5c4cd592bece0aefff70fa`:

- `node sync/native-checkpoint-process-crash.mjs`: three owned processes killed after successful production API returns, each recovered by a fresh process. Boundaries: pending checkpoint before session release; queued background ACK; after shared-session Close. Exact projection, opaque assets and journal/generation9 survived; queued baseline acknowledgement replayed; no duplicate or unintended upload occurred.
- `node sync/historical-pending-upgrade.mjs`: unchanged historical Core `65417abddb0e7efba9206d04dd0adbbbaa15a2d9` produced actual pending state. Current readers refused unbound/foreign state without transport or byte changes. Explicit adoption interrupted after checkpoint application; a fresh process resumed only the recorded principal, retained exact original archives/update/epoch/sequence/generation and replayed the original operation ID/payload once. Another fresh process did not duplicate the acknowledged upload.

Executable provenance modules and both fixtures matched raw frozen Git blobs before execution. Source verification before and after **each** command matched 3158 tracked files, input SHA256 `e100bcf09a1bc9c689ba62610ea88f3aa01328a1563a0497b1c276f577f650f2`. Archive Package.resolved remained exact, SHA256 `5e58a977a9ea432d7459bcddc420b827f3b32caba57afcc40a3d0fc358af627e`; the owner's checkout Package.resolved and installed/private profiles were not touched. The historical command used a child-only `GIT_DIR` pointing at the existing repository for its read-only historical revision/archive queries, since the isolated archive's Git metadata contains only the frozen revision. Current code and policy inputs still came from the frozen archive.

## Evidence

Private directory: `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-4eca-crash-upgrade-refresh-nf9J62/`.

| File | SHA256 |
| --- | --- |
| `receipt.json` | `ac9c17000490cf7ef93794ca6f665b600f8cc5e8d93534e52eba9ce08047c1c8` |
| `native-checkpoint-process-crash.log` | `9cd2ab28258b6b7d5de0b028129d6633e978f53c36bee46d7f8109dc44122b43` |
| `historical-pending-upgrade.log` | `765a9d1edf3084db55bda6eba9dfcdc8655d0941af0d3b7667ff8c8ec5b409f7` |

Each log records retained disposable scratch and exact copied Core input hashes. All owned children exited; no account, user-content or installed-app operation occurred.

## Limits

These are Windows Core APIs on Darwin/.NET with controlled transports, not actual Windows filesystem/UI or a real collaboration-server replay. They do not establish every internal pre/post-commit boundary, actual old Mac pending migration, sudden power-loss persistence, full T16/T17 completion or physical six-client acceptance. Preserve private state and visible packs together; recover forward without clearing unknown journals or reverting to incompatible writers. See the [native process-kill boundary](2026-10-18-native-checkpoint-process-crash.md) and [historical adoption contract](2026-10-18-historical-pending-upgrade.md).
