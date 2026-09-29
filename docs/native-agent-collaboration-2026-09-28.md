# Local native-agent collaboration check, 2026-09-28

## Scope

Local development only: signed Store-shaped TextText 1.0 (1098) in
`/Applications/TextText.app`, its bundled Codex runtime, the local Next server
on port 3000, local Postgres, and an existing private test note in the
`visual-demo` fixture. No public service or release changed.

## What failed and changed

The first overlapping run on 1097 made `append_to_item` hit a stale-hash
conflict. The agent reread the note but stopped without retrying, as the old
native and web instructions told it to stop after any tool error. The human
edit remained intact. Both instruction layers now permit one reread and
append retry after an explicit conflict that made no write. The retry checks
whether the fragment is already present and uses the latest hash. A second
conflict or uncertain write still stops.

An early run on 1098 exposed another problem: a peer append arriving while a
person typed at the end of the last line moved that person's caret after the
agent block, splitting their sentence. The Markdown surface now keeps the
caret before the new block. A focused regression test covers this boundary
and retains CRDT selection for other remote changes.

## Live result and limit

The final two overlapping runs kept the full human and agent sentences. In
the last run, the installed agent showed a stale-hash conflict, reread the
item, and appended once. The second browser editor showed the complete human
line, reached its own `Saved` state, received the agent line, and a fresh
`src/lib/store.ts` read contained both complete lines, the original Typing
marker, and the original title. The local test note's malformed lines from
the earlier failure were repaired; a fresh store read confirmed them.

The repeatable local check is `scripts/verify-native-agent-collab.ts`. It
uses a fresh marker per run, waits for the human editor to save, checks live
delivery, and reads the canonical store. Earlier exploratory runs showed a
delayed canonical save under dev-server load: the live Yjs document had a
complete human line while the ordinary post row temporarily had only its
prefix. A later materialization caught up. This check does not establish a
worst-case save delay or prove reliability under network loss or public
distribution. The agent's success text alone is not persistence proof.

## Typing-burst latency follow-up

The repeatable `scripts/bench-shared-typing.ts` check uses two authenticated
editors on a new private local note, records 30 input-to-DOM samples, and now
times final input to peer delivery and canonical store readback. On the local
development server, two pre-change runs took 11,878/12,048 ms and
5,882/5,942 ms respectively for peer/store. The relay log showed a single
POST taking 11.2 seconds in the first run and 5.0 seconds in the second:
each Yjs update in that request required a separately audited database write.

The provider now merges a bounded typing burst into one Yjs transport update
while retaining the original durable outbox entries until acknowledgment.
If the merged update exceeds the relay's size limit, it sends the original
bounded chunks. It also flushes edits queued during a slow acknowledged
request without another fixed debounce. The relay's per-update access check
is unchanged. Two post-change local development runs took 1,121/2,097 ms
and 820/1,352 ms for peer/store respectively, with local input-to-DOM p95
of 0.5 and 0.7 ms. These four runs show an improvement on this fixture, not
a worst-case latency bound or a repeated installed-native result.

## Reviewed append with a concurrent editor

A follow-up on installed local build 1111 used the Anthropic assistant's
reviewed-write path and the same two-editor test note. The first live run
staged the append, the second editor saved its line, and **Apply change**
returned a stale-hash conflict. The second editor kept its complete line;
the agent line was absent. This was distinct from the earlier native Codex
retry: the conflict occurred when the owner approved a proposal, after the
assistant's turn had ended.

The approval service now handles only an explicit no-write stale-hash result
for `append_to_item`: it reads the latest item as the same authorized actor,
checks the exact fragment is absent, and executes one retry with the new hash.
It stops after another conflict, an unreadable item, or an uncertain error.
An HTTP failure for a consumed or expired proposal now closes its review card
and tells the person to ask for a fresh change, rather than offering a button
that cannot work again.

The repeated installed-app run staged `Agent concurrent a6583181.` before
the second browser editor saved `Human concurrent a6583181.`. After approval,
the native editor displayed both complete lines. The second browser editor
received the agent line, and a fresh canonical store read retained both
lines, the original Typing marker, and the original title. This proves the
reviewed Anthropic route on the local server; it does not repeat the native
Codex provider path or establish reliability under network loss.

The local app also surfaced React's render-time state update warning while
opening this note. Workspace selection had notified subscribers inside a
`useState` initializer. Initialization now runs in a layout effect on mount
or workspace change. After the development reload, the note reopened with
its selection and no red issue badge. The two focused selection suites passed
12 tests, TypeScript passed, and touched ESLint had only existing warnings.

## Verification

- `TEXTTEXT_STORE=1 swift test --package-path mac --jobs 2 --filter Codex`:
  29 tests passed after updating an assertion for the revised instructions.
- Three focused Vitest files: 37 tests passed, including native prompt and
  remote append caret cases.
- TypeScript passed. Touched ESLint passed with one pre-existing Hook
  dependency warning in `MarkdownSurface.tsx`.
- Build 1098 passed signature verification, includes the browser-auth callback
  entitlement, and replaced 1097 at the canonical Applications path. Prior
  1097 is recoverable in Trash. No push, deployment, or public release.
- The typing-burst provider, large-paste fallback, and quarantine suites passed
  45 tests; TypeScript, touched ESLint, and `git diff --check` passed. The
  local two-editor timing runs above preserved the complete final text in
  the peer and canonical document.
- The reviewed-write follow-up passed 83 focused tests across the proposal,
  client, and assistant UI suites. TypeScript and touched ESLint passed. The
  first live run failed as described, and the second passed after the fix.
