# Six-client sync stress coordinator

Bounded, finite, seeded stress runs across six required roles: `mac-app`,
`mac-web`, `mac-cli`, `pc-app`, `pc-web`, `pc-cli`. The coordinator drives one
child process per role over JSONL, runs N rounds, and stops at the first
failure with evidence preserved. It is a command, not a service: no persistent watchers, schedules or hooks are installed. Adapters must clean
up their own remote children; an unresponsive remote actor is a failed run.

**Status:** all six real-client adapters run against the installed platform
engines, real browsers, and actual TextPack files. Physical append, browser
offline, invalid intermediate ZIP, same-position insertion, Unicode, independent
EOF replacement/append, and both Mac and PC CLI same-span replacement rounds
have passed, each with a six-client durable reopen. Earlier PC CLI rounds
failed; the failure and fresh passing receipts are in the acceptance contract.
Mac and Windows native transport-loss/reconnect and pending-edit crash/restart
rounds also passed with six clients and separate durable reopens. Deletion,
moves, and latency distributions remain open; see
`docs/verification/six-client-sync-acceptance.md`.
Targeted editor transport loss uses `offline`, for example
`{"role":"mac-web","round":1}` or `{"role":"pc-app","round":1}`.
The selected browser or native app goes offline after the readiness barrier,
edits while the other five clients edit, then reconnects before convergence.
The browser and native app cases have physical passing receipts. The native
transport gate is private to the stress actors; production editing still uses
its normal local checkpoint and hosted collaboration paths.
Set `restart` to `{"role":"mac-app","round":1}` or
`{"role":"pc-app","round":1}` to crash and relaunch the native process after
all six input adapters acknowledge their local edits but before convergence. The relay must preserve the
pending journal, skip graceful flush, use a fresh mailbox generation, reopen
the dedicated fixture, and report the new process generation. The first state
after restart must prove that the editor session ID changed.
Set `transientInvalid` to `{"role":"mac-cli","round":1}` or
`{"role":"pc-cli","round":1}` to test a brief invalid TextPack write and
atomic repair while all six editors stay open. The Mac CLI physical run passed.
The initial PC CLI run failed when the Windows editor left its selected file.
The repaired Windows test build then passed a fresh two-round, six-client PC CLI
replay. The failing and passing receipts are linked in the acceptance contract.
Set `pattern` to `"same-position"` to make the four real editors insert at
the start of the document concurrently while both CLI actors append to the
underlying TextPack. The runner still checks every exact marker, baseline
preservation, editor continuity, and identical text. Fresh physical runs of
one and five rounds passed; see the acceptance contract. This does not cover
overlapping replacement or deletion.
Set `pattern` to `"unicode"` for concurrent edits containing accented Latin,
Japanese, and emoji text. A fresh physical five-round run passed on all six
clients with exact text equality and durable file checks.

Set `expectedAssetHashes` to a map of up to 32 `assets/...` paths to SHA-256
hex digests. Both physical CLI actors then attest the exact decompressed asset
bytes on every observation, including a durable reopen; matching text alone
cannot pass. Set `assetReplacement` to `{ "role": "pc-cli", "round": 1,
"path": "assets/data.txt", "bytesBase64": "..." }` to replace one existing
asset in the same atomic TextPack write as that actor's planned text edit.
The replacement bytes must hash to the matching `expectedAssetHashes` entry.
Use a small disposable asset; the protocol caps the encoded payload at 96 KiB.
Seed 88 passed three rounds with an unchanged asset and a separate six-client
reopen. Later single-entry replacements from each CLI passed with fresh-process
reopens; see the acceptance contract. For simultaneous replacements of two
different entries, use `assetReplacements` with exactly two entries in the same
shape, one for `mac-cli` and one for `pc-cli`, with distinct asset paths. The
runner checks both final hashes at each file actor. Seed 111 passed two real
six-client rounds with both replacements, followed by seed 112 reopening all
six clients; receipts are in the acceptance contract.

For an exploratory same-entry race, set `diagnosticSameEntryRace: true` and
provide two different replacement byte values for the same asset path in
`assetReplacements`, with no `expectedAssetHashes`. The runner records each
actor's proposed hash and the two observed file hashes. Differing file hashes
fail the diagnostic. It never emits an acceptance result: a matching document body alone cannot prove that the losing
binary version is preserved or that every editor displays the correct asset.

Set `pattern` to `"overlap-replace"` for four live editors replacing the
existing fixture sentence while both CLIs append. Set `pattern` to
`"file-overlap"` for the same four editors plus one CLI replacing that exact
sentence in the TextPack and the other CLI appending. Odd seeds select the Mac
CLI for replacement; even seeds select the PC CLI. The runner requires every
marker exactly once, the original sentence removed, identical hashes, and
continuous editors. PC CLI seed 70 and Mac CLI seed 71 passed with six-client
durable reopens. Seeds 66 and 68 exposed the Windows checkpoint and terminal
newline bugs that the current regressions cover.
Set `pattern` to `"partial-overlap"` to have the four live editors replace
`Existing fixture text.` while one direct-file actor replaces only
`fixture text.` and the other appends. Odd/even seeds switch which machine's
CLI performs the partial replacement. The expected result retains every
marker once and removes the union of the original text. Seed 87 passed a
physical six-client round and a separate durable reopen; see the acceptance
contract for exact receipts.

Set `sustainedTyping` to `{ "chunks": 8, "intervalMs": 50 }` with the
append pattern for bounded real editor input sequences. The four editors type
2–16 unique Unicode chunks with 10–250 ms spacing; both direct-file actors
perform their ordinary writes concurrently. One final `applied` reply contains
contiguous ordinal, visible-text and monotonic-time receipts for the one logical
operation. Failure preserves the confirmed prefix and any uncertain attempted
chunk. The coordinator accounts for each exact chunk independently, permitting
cross-actor CRDT interleaving. This capability has source/orchestration tests;
physical sustained typing acceptance is pending. See
`docs/verification/2026-10-18-sustained-typing-runner.md`.

## Run

```
node sync/stress/run.mjs sync/stress/example.simulated.json
node --test sync/stress/stress.test.mjs
```

For a real run, create a fresh, dedicated `Six-client acceptance …` TextPack
in the selected workspace and wait until the file is present on both machines.
Make a config with `mode: "real"` and these role commands:

| Role | Driver |
| --- | --- |
| `mac-app` | `python3 mac/scripts/stress-native.py --actor <private flagged .app>/Contents/MacOS/TextText --config <mac-app.json> --session <new directory>` |
| `mac-web` | `node sync/stress/browser-adapter.mjs <mac-web.json>` |
| `mac-cli` | `node sync/stress/file-adapter.mjs <mac-cli.json>` |
| `pc-app` | `ssh pc node <pc-source>/scripts/stress-native-relay.mjs <acceptance.dll> <pc-app.json> <new directory>` |
| `pc-web` | `ssh pc node <pc-source>/sync/stress/browser-adapter.mjs <pc-web.json>` |
| `pc-cli` | `ssh pc node <pc-source>/sync/stress/file-adapter.mjs <pc-cli.json>` |

Use a fresh fixture for each run and one new session directory per native run.
Close the normal native apps before
starting their test actors; the browsers may remain signed in. `auth: "saved-app"`
exchanges the already signed-in native account in memory for a browser session.
The private Mac actor must be built with `-DTEXTTEXT_STRESS_ACTOR` and signed
with the normal app group entitlement. Its test config and session need an
explicit sandbox-readable writable location. The Windows relay registers a
one-shot interactive task and unregisters it after a clean exit. No secrets
go in the coordinator config or arguments.

Exit 0 only when every round converged. Output goes to a fresh directory
`<outputDir>/<runId>/` (the example uses ignored `.texttext/sync/stress/`):

- `results.jsonl`: every event (attestations, rejected events, rounds, failure, adapter exits), redacted, lines bounded.
- `summary.json`: status, failure code/detail, `acceptance` (`six-client-append-only` for a passed real append run, else `none`).
- `dashboard.html`: static page, auto-refreshes every 2 s while running, stops refreshing when done. Open it in any browser; nothing is served.
- `plan.json`: exact seeded edits for replay.
- `adapters/<role>.last-state.json`: last observed text and editor evidence.
- `adapters/<role>.stderr.log`: first 64 KB of adapter diagnostics.

For a durable reopen check, set `rounds: 0` and set `expectedBaselineHash` to
the final round's `hash` in the prior receipt. Use new native session directories.
The runner opens all six clients, verifies the saved document hash and editor
mounts, then closes only its own actors. Its acceptance label is
`six-client-reopen`.

## Config

```json
{
  "mode": "simulated",
  "seed": 42,
  "rounds": 5,
  "timeoutMs": 10000,
  "fixture": { "workspaceId": "ws-...", "itemId": "item-..." },
  "outputDir": ".texttext/sync/stress",
  "roles": {
    "mac-app": { "command": ["node", "path/to/adapter.mjs"], "cwd": ".", "env": { "KEY": "value" } },
    "...": "all six roles are required"
  }
}
```

`command` is an argv array, never a shell string. Adapters receive only `PATH`
plus the listed `env`; host environment and credentials are not inherited. Put
no secrets in `env` values that adapters would print; logged lines are redacted
for common credential keys, but redaction is a backstop, not a channel.

## Protocol

Newline-delimited JSON. Coordinator writes to the adapter's stdin, adapter
answers on stdout (stderr is captured as diagnostics). Every adapter message
carries the `round` it answers; events for another round or a second event of
the same type in one round are rejected and recorded, never counted.

| Coordinator sends | Adapter replies |
| --- | --- |
| `{"type":"hello","runId","role","mode","fixture":{workspaceId,itemId}}` | `{"type":"attest","round":0,"mode":"real"\|"simulated","workspaceId","itemId","machineId","adapter"}` |
| `{"type":"prepare","round"}` | `{"type":"ready","round"}` |
| `{"type":"edit","round","edit":{id,op:"append",text}}` | `{"type":"applied","round","editId"}` |
| `{"type":"transport","round","online":false\|true}` | `{"type":"transport","round","online":false\|true}` |
| `{"type":"restart","round"}` | `{"type":"restart","round","generation"}` |
| `{"type":"observe","round","expectedEditIds":[...]}` | `{"type":"state","round","text","editIds":[...],"editor"?:{sessionId,reloads}}` |
| `{"type":"shutdown"}` | process exits |

An adapter may send `{"type":"error","round","message"}` at any time; that
fails the run as `actor-failed`. Unexpected exit fails it as `actor-exited`.

Per round: all six must be `ready` (barrier) before the six edits are
dispatched concurrently; then all six `applied` IDs must match the plan. An
offline participant reconnects only after this barrier. A configured native
restart also occurs after this barrier and before reconnect or observation,
so it tests recovery of an edit that was visible but not given a save wait.
The restarted app must use its reported new editor session for the remainder
of the run; every other app and browser keeps its original session. The
coordinator re-observes temporarily different replicas within the configured
deadline while all actors remain live. Acceptance requires three consecutive
all-six observations, separated by 500 ms, with the same semantic hash and
complete operation, baseline and asset evidence. Divergence resets the streak.
Editor continuity is checked on every observation. The independent zero-round
reopen also checks three samples of the specified durable hash. At convergence, every `state` must
produce one identical hash (only CRLF normalized to LF, `text` at most 64 KB) and exactly the cumulative expected
edit ID set. App and web roles must report `editor` with the same `sessionId`
as the initial round-zero observation, with zero `reloads`. Each exact planned
text must occur once; removing those texts must reproduce the original baseline
exactly, so agreement on lost content cannot pass. Adapters insert the exact
provided text without adding separators. Each wait is bounded by `timeoutMs` (100..120000 ms); a timeout
names the missing roles. After any failure or completion the coordinator sends
`shutdown`, then SIGTERM, then SIGKILL, each bounded.

Attestation rules, checked before round 1: every adapter must report the
configured fixture; its `mode` must equal the run mode (modes cannot be mixed,
and a `real` run rejects any simulated adapter); roles on the same machine
prefix must report the same `machineId`, and `mac` and `pc` must differ. The
generic process adapter asserts nothing about reality; only a concrete adapter
that drives a real client may attest `real`, and `fake-adapter.mjs` never does.

Rounds are generated by a seeded PRNG, so the same seed and round count always
produce the same edit plan; put the seed from a failed `summary.json` back into
the config to reproduce the run.

## Private actor identity preparation

Real runs require `expectedIdentities` for every role. Each actor reports actual
loaded artifacts and its runtime; the coordinator checks the complete pinned
identity before accepting readiness and checks a fresh identity after native
restart. Browser source is bound by the trusted deployment ID/asset mapping;
`/api/app/build` is fetched uncached. A CLI actor reports a workspace owner
binding, not an authenticated account actor. Reopen requires the prior successful
physical summary, the same fixture, pins, assets and durable final hash.

`build-private-actor.mjs` is a human-invoked private build wrapper. Its JSON input
requires absolute `repository` and fresh `destination`, an explicit committed
`ref`, and `role`. Mac native builds also require `macEdition` (`standalone` or
`store-local`) and the existing signing environment. Windows native builds use
an explicit `dotnet` matching the existing private SDK. It builds a fresh Git
archive, verifies tracked bytes/modes/symlinks and unexpected source inputs
before and after, records fixed build steps and output hashes, and creates an
immutable sidecar. This is a trusted local build receipt, not cryptographic
build attestation. It neither installs nor releases the candidate.

For Store actors, `sidecar` is mandatory: supply an absolute, previously unused
JSON filename in an **existing sandbox-readable app group/session parent**,
outside the signed `.app`. Keep the build destination separate. Do not precreate
the relay's fresh session directory: put the identity sidecar alongside that
directory in its already accessible parent. Set actor config `identityReceipt`
to exactly that sidecar path, and launch through the existing native relay with
its new session path. The actor must read and hash-check that receipt at hello;
an inaccessible sidecar fails readiness. No signed bundle resources are edited.
For other roles the sidecar defaults to `destination/StressBuildIdentity.json`;
`sidecar` can explicitly select an existing parent. All sidecars are create-only.

`seal-artifacts.mjs` can separately seal a completed coherent build receipt using
explicit `repository`, `sourceRoot`, `buildReceipt` and absolute `sidecar` paths.
It rechecks pristine source and actual fixed artifact paths; arbitrary receipt
paths cannot redirect executable, Core, UI or driver hashing. Never seal an old
receipt after replacing an actor executable. Wrapper/source fixture tests and
native compilation are preparation evidence only, not six-client acceptance.

## Keyboard undo/redo scenario

`undoRedo: true` is append-only and excludes `sustainedTyping`. Four editor actors
wait 450 ms (the editor history capture window is 400 ms), insert one unique
marker through real input, send platform undo, then redo. Each stage must show
its own marker exactly once, absent, then exactly once, while preserving the
initial body and every non-own character observed at earlier stages, including
prior-round markers. Remote additions may interleave. Only the final append is
one accounted operation; intermediate history observations are not extra edits.
File actors keep their concurrent ordinary writes. This does not implement
multi-field history, replacement/deletion history or a complete T22 matrix.

`historyProgress` contains the exact edit ID and ordered insert/undo/redo stages,
marker text, expected occurrence count, preservation confirmation and monotonic
elapsed milliseconds. Failures retain the confirmed stage prefix and uncertain
`attemptedStage`; missing, skipped, wrong-actor or content-loss evidence fails.
The isolated `undo-redo.browser.mjs` fixture checks real browser keyboard events,
not TextText collaboration or physical acceptance.

## Body and subtitle scenario

`multiField: true` uses a dedicated existing article whose Subtitle is populated
and visible. Title and file stem remain fixture identity. It requires plain
append; sustained typing, undo/redo and asset replacement combinations are
rejected. Each of the six actors authors two role-bound suboperations, body then
subtitle. Four editor actors focus the real existing fields and enter keyboard
text. File actors write both text.md body and the existing canonical `excerpt`
JSON string in one guarded ordinary external replacement, preserving all other
entries including document.json and projection baseline. Production reconciliation
must materialize the final coherent document.

Editor observations use the readonly `window.texttextDocumentInspection` API,
which returns the actual current provider snapshot. The selected editor's exact
registration key, fixture, visible body/subtitle, account/root and editor
continuity must match. No document is reconstructed from DOM plus server/disk.
Each file actor reads its complete document.json from the same ZIP bytes as its
body/assets observation. All six full snapshots must converge across three
samples. Accounting strips only the twelve planned field markers per round,
preserves both original field baselines and all other document semantics, and
requires equal complete canonical hashes. `finalHash` remains the body hash;
`finalDocumentHash` also pins the complete document.

An independent `rounds: 0` reopen keeps `multiField: true` and requires both
`expectedBaselineHash` and `expectedDocumentHash`, plus the preceding successful
physical receipt and unchanged artifact/asset pins. Body-only reopen cannot
stand in for a multi-field receipt. CLI owner binding is rechecked on each
operation and immediately before replacement; it remains an ordinary file
writer rather than an authenticated account actor.

## Owned browser crash/restart

`restart` may name any app or browser editor. A browser restart happens after
the all-six applied barrier. The driver proves the browser PID and exact
configured persistent profile through CDP immediately before SIGKILL, then waits
for both disconnection and actual process disappearance before relaunch. Missing
CDP proof, a changed PID/profile, graceful close evidence or unverified exit fails.
The owned acceptance launch explicitly enables Chromium automation so its command
line can be inspected. No process-name matching or profile deletion is used.

The replacement browser uses the same profile/channel, a new generation/session,
and fresh observed browser version, deployment/assets, source receipt and account
principal. Expected identity pins must still match before restart is accepted.
Saved-app login exchange is performed only on the initial launch. The other five
actors must retain their mounted editor sessions throughout convergence.

For held offline browser input, set `offline` and `restart` to the same browser
role/round. Process death ends its network emulation; the new browser loads online
and reconnects its persisted local journal. Evidence explicitly records
`reconnectByRestart: true`, rather than claiming an offline page reload. The
coordinator's following online=true command is idempotent. Plain browser restart
without that offline case does not prove an upload was pending at the kill.
The isolated browser crash/journal fixture proves driver/profile mechanics and
browser storage recovery, not TextText or six-client physical acceptance.

## Ordinary in-place and rapid file writes

`fileWrites: { role: "mac-cli", mode: "in-place", writes: 3, intervalMs: 10 }`
selects one CLI actor; rotate `mac-cli` and `pc-cli` in separate campaigns. Mode
is `in-place` or `atomic`, writes is 1..8, intervalMs is 10..250, and the complete
run is bounded to 600 accepted suboperations including the other five actors.
Only plain append is supported; other input/asset/fault scenario combinations
are rejected. More than one write is a rapid burst. Existing atomic append
behavior remains available without this flag.

Each write appends a unique seeded-plan chunk. The final chunk contains the
ordinary role marker, while every write has its own role-bound suboperation ID.
Every attempt retains the observed preimage backup. In-place uses the original
r+ file descriptor, verifies inode/preimage, truncates, writes and fsyncs; it
never falls back to rename. Atomic writes fsync a new temporary file before
rename. Both require exact readback, the expected file identity behavior and
unchanged binary assets. Precondition failures preserve the observed external
file and retry at most five times. A post-truncate or uncertain readback failure
stops with the confirmed write prefix and attempted phase/byte count; no repair
or success is invented. Fsync evidence concerns file contents, not machine power
loss durability of directory metadata.

This scenario requires an existing article with visible populated Subtitle so
all six actors can provide actual complete live snapshots. Convergence checks
body chunks independently (allowing CRDT interleaving), complete document
semantics and exact asset pins. Independent reopen requires the same fileWrites
configuration, `expectedBaselineHash`, `expectedDocumentHash` and prior physical
receipt. These modes do not implement whole-pack creation or the remaining file
lifecycle/malformed metadata matrix.

### Malformed source, held observers, guarded repair

`malformedRepair: { role: "mac-cli", kind: "truncated-zip", holdMs: 100 }`
selects either CLI role and `truncated-zip` or `invalid-document-json`.
This bounded plain-append scenario excludes other fault/input modes and allows
at most 20 rounds. Use an existing article fixture with a populated Subtitle.
The latter fault is a valid ZIP with deliberately incomplete canonical JSON;
the former is an actual prefix of the original ZIP. Original and fault bytes
are retained as separate fsynced create-only evidence files.

After the all-ready barrier, the selected ordinary file writer installs the
fault with guarded atomic replacement and verifies raw source identity/hash.
The coordinator waits at least holdMs, reads actual full document state from the
other five still-mounted sessions, checks unchanged semantic state/edit IDs and
editor lifetime, and asks the fault actor to prove the malformed source still
exists. The receipt records actual elapsed hold time, including observations.
It then restores the exact original bytes only if the fault inode/hash and
owner binding still match. Six ordinary edits run afterward, with exact operation
accounting and three all-six full-document convergence samples. Faults are not
accepted edits. No typing during the malformed window is claimed.

A failed probe fails the run even if guarded cleanup succeeds. Cleanup never
recreates a deleted path or replaces externally changed/repaired bytes. The
original, malformed image, attempt journal, and failure remain available.
Real mode requires every original asset byte hash in expectedAssetHashes, plus
normal artifact/principal pins. Independent zero-round reopen requires the same
fault configuration, prior passing physical receipt, final body/full-document
hashes and asset pins. Simulated protocol tests and local filesystem fixtures
are preparation evidence, never six-client physical acceptance.

### PC normal close with observed peer typing overlap

`closeDuringTraffic: { role: "pc-app", trafficRole: "mac-web", chunks: 8, intervalMs: 250 }`
selects PC native normal close with either browser peer as the traffic source.
Only one plain-append round or an independent zero-round reopen is supported;
other scenario combinations and unknown fields are refused. Use an existing
article fixture with Subtitle and complete asset hash pins.

The PC actor accepts its own ordinary edit first. The other five roles then edit,
with the selected browser inserting actual keyboard chunks and streaming each
visible, monotonic accepted prefix. After its first visible chunk the coordinator
requests the existing production PC close path. At least one later visible chunk
acknowledgment must arrive while the close request is pending. If close returns
too quickly, this scenario fails as insufficient observed overlap; the runner
adds no product delay. This evidence is coordinator-observed overlap, not a
synchronized native/input event trace. Every streamed prefix must match the exact
final browser operation, and uncertain/partial input remains failure evidence.

Successful normal close must report closed, flushed, and no Keep editing dialog.
The relay then requests idempotent shutdown/flush, verifies actual process finish,
and starts generation2 from the same fixture configuration. It never crash-kills
the already normally closed actor. Fresh source/principal/session attestation is
required before all-six full-document convergence can accept the run. Own and
peer markers must each occur exactly once. Independent reopen requires the prior
passing physical receipt, exact scenario, body/full-document hashes, assets and
artifact pins. Other-role close-under-traffic, forced dirty-journal timing, and
physical campaigns remain separate work. The legacy closeProbe still means
normal PC close after convergence only.

### Mac normal window close with observed peer typing

The same closeDuringTraffic object now also accepts `role: "mac-app"` with
mac-web or pc-web as trafficRole. Its timing/operation/refusal/full-reopen rules
match the PC scenario above. The Mac actor requires its actual accepted own edit
for that round and verifies the marker once in both the visible editor and the
actual fixture pack after normal close.

Mac close means `NSWindow.performClose` through the production durability guard,
an actual willClose notification, a hidden original window, no Keep editing
sheet, and a typed shared durability receipt bound to the fixture item/workspace.
A process exit, hidden window alone, idle receipt, or local-only durability label
cannot satisfy the proof. The original controller/WebView/native session remains
retained as in Command-W. The window-reopen command calls production present,
requires the same mounted editor/session and process/mailbox generation1, and
records windowGeneration2 only after the observed close/reopen cycle. It obtains
fresh actual source/account/root attestation. No SIGKILL, process restart or
fabricated new editor session is used. Final actor shutdown performs a fresh
flush before normal controller disposal; close does not cache final-flush success.

Fresh physical campaigns and independent fresh-run reopen are still required.
The isolated NSWindow/WK fixture covers the actor's real close guard strategy,
not authenticated product collaboration. Browser-close, other combinations and
forced dirty-journal timing remain separate coverage.

### Browser normal close before convergence

`browserClose: { role: "mac-web", round: 1 }` also accepts `pc-web`. It supports
one plain append round, or an independent zero-round reopen with the same
scenario and prior receipt. Other fault, multi-field, sustained typing, history,
attachment replacement and malformed-file scenarios are refused in combination.
After all six input receipts, before convergence, the selected browser closes its
actual page with `runBeforeUnload: true`. The adapter requires the page close,
normal context close, and disappearance of the exact owned browser PID. It never
uses a kill signal. Reopen uses the same persistent profile without exchanging a
new login, a different observed browser PID, generation 2, and fresh actual
artifact/account/editor attestation. The other five actors remain mounted.

A beforeunload dialog is dismissed to keep the guarded page open, and the run
fails. The actor reports its verified browser/profile and driver ownership, enters
a retained error state, and accepts no further mutations. In a real configured
scenario the coordinator stops the other five actors but sends no shutdown,
stdin-close or kill to the guarded actor. The retained driver keeps its browser
alive after the coordinator exits; `summary.json` and the console report the
owned processes for owner review. A timed-out or unreadable close reply also
retains the known adapter child, with browser ownership explicitly unverified;
an absent reply is never permission to kill the potentially guarded browser.
Fresh successful close/reopen proof is required before ordinary cleanup resumes.
Closing a proven guarded browser after reviewing pending edits ends its driver. This is an explicitly invoked failed acceptance
process, not an installed background job. Do not force cleanup to manufacture a
successful close receipt.

Passing requires the existing exact marker/baseline/asset checks and three
all-six convergence samples, plus a separate durable reopen. This bounded slice
covers normal close after acknowledged input; it does not claim a forced dirty
journal, offline close, dropped transport acknowledgement, two-account access,
or a completed physical campaign. The isolated
`browser-normal-close.browser.mjs` fixture exercises real keyboard input,
normal close/profile reopen and retained child ownership across parent exit.
Its explicit disposable-fixture cleanup is separate from the production runner's
retained-page policy, and it never emits six-client acceptance.

### One external folder case change

`folderCaseMove:{role:"mac-cli"|"pc-cli",round:1,source:"Six-client acceptance folder <UUID>",destination:"six-client acceptance folder <same UUID>",emptyDescendants:["Empty","Empty/Nested"]}` selects one isolated append round. Provision a **new dedicated owned folder** and one article inside it; never point this scenario at Notes, the workspace root, or existing content. Declare every empty descendant and its ancestors. Unknown entries, links, a distinct destination, or incomplete membership refuse the mutation. Other fault/input scenarios cannot be combined with this one.

Six ordinary inputs first converge with full-document and asset accounting. Three stable per-role observations pin exact source spelling, tree membership and each machine's own archive bytes. One ordinary direct-file actor retains the original archive and proof, rechecks the owned tree and account/root guard, and calls the OS directory rename. This Node rename does **not** promise atomic no-overwrite protection against an arbitrary external filesystem race. Failure retains evidence and never rolls back, prunes or deletes another path.

Native actors report read-only OS directory identities and exact pack bytes alongside the existing live editor/session observation. Web actors report the authenticated folder manifest alongside the actual selected editor; this does not claim a UI breadcrumb observation. ZIP bytes must remain equal on each machine before/after, not between machines. Three complete post-move observations require exact destination paths including empty descendants, old exact spelling absent, same UUID, document/assets, existing editor sessions, and no open review dialog. A temporarily unchanged old tree is pending, bounded by the scenario timeout. There is no concurrent typing during the directory move phase. Independent zero-round reopen must use the same scenario and prior final proofs. Simulated tests and isolated filesystem fixtures are not six-client physical acceptance.

For physical acceptance, include at least one real disposable binary asset and pin its hash in the fixture configuration. An empty asset set proves no binary-asset behavior. The article title must equal its actual filename stem: creation can append an ID suffix, so use the advertised guarded title update on this new item and independently verify its path stayed unchanged. Do not loosen the title/path guard or reuse an older Notes fixture.


### One ordinary external file leaf move

`leafMove:{role:"mac-cli"|"pc-cli",round:1,source:"Six-client acceptance folder <UUID>/Six-client acceptance <original title>.textpack",destination:"Six-client acceptance folder <same UUID>/Six-client acceptance <different leaf>.textpack"}` selects one same-parent, non-case-alias file rename. It requires a fresh dedicated owned folder with exactly one article and no descendants, an immutable original document title, and a real binary asset with complete hash pins. All six actor configurations carry this exact scenario; only the declared source or destination may differ from the original title stem. Ordinary configurations retain their existing strict filename/title guard.

Before any text inputs, three stable observations from all six mounted roles bind root/account/item, exact source presence, absent destination, full snapshot/assets and live native shared-session paths. The selected CLI retains immutable baseline ZIP/proof evidence, rechecks scope, and invokes a separate no-overwrite OS helper. Darwin uses a pinned parent directory and `renameatx_np(EXCL|NOFOLLOW_ANY)`; Windows uses pinned non-reparse ancestors and a held source handle with `FileRenameInfo.ReplaceIfExists=false`. Windows process-only PowerShell execution-policy bypass does not alter machine policy. There is no product mutation API, destination overwrite, unlink, rollback or alternate-name retry. Darwin lacks expected-inode rename CAS: a last-instant foreign source replacement can still be moved, but postidentity verification fails and preserves actual paths/evidence. This is not unconditional protection from arbitrary filesystem races.

Filesystem proofs require a bounded workspace uniqueness scan (10,000 entries/256MiB read), excluding only root `.texttext` retained metadata. Duplicate stable IDs, unsafe entries, unreadable/unparseable packs and incomplete scans refuse the scenario. Browser proofs use the existing authenticated manifest and actual complete-pack route, checking revision/ETag/path and canonical bytes. Browser identity is `manifest`, with no invented inode or native selected path. Native selected paths come from the actual mounted shared session; destination-on-disk with a still-old session path is pending, never convergence.

Three all-six destination observations must pass before normal six-role concurrent append input is released. One move receipt and six exact text operations are accounted separately. After typing, three fresh destination/snapshot/asset observations qualify final evidence; legitimate save replacement can change each machine's inode and ZIP bytes. Independent zero-round reopen requires the same scenario, prior passing physical receipt, final full-document/body/asset hashes, unchanged artifact/account pins and fresh processes. Each role must reproduce its own final path proof. No creation, deletion, folder topology mutation, general cross-folder move or complete physical matrix is claimed by this bounded scenario; simulated unit runs always report acceptance `none`.
