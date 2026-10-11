# Six-client sync stress coordinator

Bounded, finite, seeded stress runs across six required roles: `mac-app`,
`mac-web`, `mac-cli`, `pc-app`, `pc-web`, `pc-cli`. The coordinator drives one
child process per role over JSONL, runs N rounds, and stops at the first
failure with evidence preserved. It is a command, not a service: no persistent watchers, schedules or hooks are installed. Adapters must clean
up their own remote children; an unresponsive remote actor is a failed run.

**Status:** the coordinator and all six real-client adapters are implemented.
The Mac actor uses a private test build of `LocalVaultWindowController`; the
Windows actor uses the production `MainWindow` in an interactive desktop task;
Chrome and Edge use the real hosted editor; CLI actors edit the actual TextPack
file. The adapters never replace the installed app or bypass its sync engine.
Physical campaigns on October 10 passed one, five, and ten rounds on fresh
fixtures. This is acceptance evidence for simultaneous append and editor
continuity. A zero-round six-client reopen against the ten-round final hash
also passed after the live actors exited. Native offline, crash, deletion, replacement, move, and latency scenarios
remain outside this runner's current coverage; see
`docs/verification/six-client-sync-acceptance.md`.
Targeted browser transport loss is now covered: set `offline` to
`{"role":"mac-web","round":1}` or `{"role":"pc-web","round":1}`.
The selected browser goes offline after the readiness barrier, edits through
its real editor while the other five clients edit, then reconnects before
convergence. Both platform-specific physical runs passed. Native transport
loss and pending-edit crash recovery remain open.
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
| `{"type":"observe","round","expectedEditIds":[...]}` | `{"type":"state","round","text","editIds":[...],"editor"?:{sessionId,reloads}}` |
| `{"type":"shutdown"}` | process exits |

An adapter may send `{"type":"error","round","message"}` at any time; that
fails the run as `actor-failed`. Unexpected exit fails it as `actor-exited`.

Per round: all six must be `ready` (barrier) before the six edits are
dispatched concurrently; then all six `applied` IDs must match the plan. The
coordinator re-observes temporarily different replicas within the configured
deadline while all actors remain live. At convergence, every `state` must
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
