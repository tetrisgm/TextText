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
