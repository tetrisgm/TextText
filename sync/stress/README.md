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
