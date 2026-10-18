# Native shared checkpoint process-kill recovery

T16 bounded process-termination evidence. No product code or test hooks change. Existing `CheckpointFailureTests` and shared move fixtures cover canceled/error/throw-and-reconstruct paths; this fixture adds actual process termination after successful production API returns.

## Command and result

`node sync/native-checkpoint-process-crash.mjs`

Pass: `/private/tmp/texttext-native-checkpoint-process-crash-20261018.log`. Three owned worker processes were SIGKILLed and three fresh processes recovered their fixture. Current Core input hashes and retained scratch path are printed in the log and stored in scratch `current-source-hashes.json`.

| Boundary | Actual evidence before kill | Fresh-process result |
| --- | --- | --- |
| Pending checkpoint before session release | Real `CheckpointAsync` returned exact projected hash/generation9; pending journal durable; session still live. | Exact projection/archive assets/checkpoint bytes; epoch4/seq6/generation9 and pending=true reopen; no unintended upload. |
| Clean checkpoint with queued background ACK | Controlled transport holds the real `SyncEngine` gate during Manifest; `CheckpointAsync` returns while real `TryAcknowledgeCheckpointAsync` leaves `acknowledge.json` queued. | Exact ACK bytes survive kill; production `ReconcileAcknowledgements` persists accepted hash/acknowledged revision into sync baseline and consumes ACK; checkpoint remains exact; no duplicate upload. |
| After shared session close | Real checkpoint return followed by actual `SharedEditingStore.Close` return; release flag included in READY. | Fresh session opens after process death, retains exact projection/journal/assets and pending semantics. |

The clean fixture's controlled transport stores the exact accepted remote bytes/revision before the clean checkpoint, modeling collaboration acknowledgement. It is not a real collaboration server or server-ACK acceptance gate. Pending variants retain a valid fixture Yjs update; they do not replay it to a server.

## Process ownership and scope

The parent creates a new canonical OS scratch directory and random per-case nonce, then starts one known child DLL. It receives READY only after production checkpoint return, verifies the receipt PID equals `child.pid`, exact nonce/mode/generation/queued-ACK/release values, rereads the fixture nonce and checks the child has not exited. It signals only that owned child, waits for actual SIGKILL exit, then starts an independent recovery process. It does not infer a window close from process exit, launch installed apps, or target unrelated PIDs. Scratch is retained; no user content is read or removed.

This runs Windows Core source on Darwin/.NET using existing test tooling and the real shared TypeScript policy through the test-only evaluator. It is not actual Windows filesystem/native UI, Mac app, full six-client acceptance, a pre-internal-commit kill, or machine/power-loss evidence. Flush semantics under process kill do not establish directory persistence under sudden power loss. Wider T16 remains open.

## Source hashes

| Path | SHA-256 |
| --- | --- |
| `sync/native-checkpoint-process-crash.mjs` | `ad3aa9aaca83218f7a5fa4179577bb0c349e03f450c3f5913e5efc37a765f1e5` |
| `sync/fixtures/native-checkpoint-crash/Worker.cs` | `077e2bd8975327cf3e4480d2a06a9e6468d6b2b8e5cde60e40422913d0fed203` |

An initial controlled transport omitted binary-manifest/read support, reached successful pending recovery and queued-ACK preservation, then refused the clean case's asset-revision refresh. Adding actual fixture remote-asset manifest/read responses fixed the fixture; no production behavior changed.

Recovery uses a compatible forward reader to reopen retained checkpoint and queued acknowledgement. Preserve private state and visible packs together. Do not clear a journal or ACK to bypass a refusal; preserve scratch/logs for inspection if this gate fails.
