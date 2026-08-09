# TextText.app handoff

## Current position

Two branches are open off `main`, both pushed, neither merged.

1. **`simplify-core-ux`**: the UX simplification pass. Its audit and open items
   are in that branch's copy of this file.
2. **`live-collab-proof`** (this branch): proof, in real browsers, that an agent
   participates in a document the way a second person does, plus the two fixes
   that proof forced.

## The evaluation

`scripts/verify-live-collaboration.ts`:

```bash
npm run eval:collaboration:browser
```

It starts the built server as a child process, drives two Chromium browsers and
a real agent against it, and kills the server in a `finally` block, so nothing
is left running. Screenshots go to `LIVE_COLLAB_SHOTS` (default
`/tmp/live-collab`); `LIVE_COLLAB_HEADED=1` watches it happen.

The two people are two dev-login accounts, Ada and Grace, so they are genuinely
two users rather than one session in two tabs. Ada creates an item and invites
Grace as an editor through the real share dialog. The agent uses the two
transports a hosted client uses: `POST /api/agent/presence` for presence and
`POST /api/mcp` for writes, carrying the protocol headers and `_meta` a real
client sends, including the `clientInfo` name that decides which collaborator
renders.

The other collaboration checks drive Yjs clients in process and ask whether
state converges. This one asks whether a person can SEE the other participant,
which is a different question and the one that was never covered.

**All 24 checks pass.**

- **Two people, live.** Ada's typing reaches Grace and Grace's reaches Ada with
  no reload. Grace's browser paints Ada's selection labelled "Ada". Ada's
  toolbar shows Grace as present.
- **An agent is a collaborator.** Codex appears in the same presence row as the
  two humans, with a caret in the text rather than only an avatar, and stops
  being a collaborator when its work finishes.
- **Every documented client is itself.** ChatGPT, Claude, Cursor, and Codex each
  render under their own name and colour.
- **An agent's CRUD is visible.** `append_to_item` and `update_item` land in an
  already-open editor with no reload and survive the human's next save.
- **Contention holds.** An agent writing while both humans are actively typing
  reaches both of them, and all three contributions survive the merge.
- **The sidebar assistant is not a special case.** Its executor, `/api/ai/tools`,
  is session-authenticated and calls the same `runWorkspaceToolForSession` the
  hosted adapter uses. Driving that executor from Ada's own browser session
  shows the assistant's section appear in both open editors, like typing.

`src/lib/__tests__/agent-participation-contract.test.ts` pins the pieces the
live run depends on, so a regression is caught in seconds rather than at the
next live run.

## What the proof forced

**The sidebar assistant published no presence at all.** `agentPresence` in
`src/lib/mcp/tools.ts` returned null for any actor that was not
`external_agent`, and the in-app assistant is `actorType: "ai"`. So an assistant
edit arrived in an open document with nobody attached to it, which is precisely
what a human edit never looks like. The gate now excludes only `human` actors,
who have browser presence of their own, and
`runWorkspaceToolForSession` supplies `connectionName: "Assistant"`. The check
was written first, watched fail, then watched pass.

## The defect this found, and the trap it nearly set

**A watcher's view did not follow a colleague's caret.** Presence was
write-only: `/api/collab/{postId}/presence` had only a POST, so a browser
learned where everyone's cursor was solely from the response to its own
heartbeat. Someone who is only watching never changes their own awareness, so
their heartbeat stayed on the slow 8 second interval and the caret they saw was
up to that far behind. Watching a colleague write is the common case, so this
was the wrong shape.

The route answers GET now, and the provider polls it on its own 1200 ms timer
(`PRESENCE_POLL_MS` in `src/lib/collab/provider.ts`). Measured after the change:
an idle watcher sees the writer's caret move after **1218 ms**, which is the
poll interval, so the transport is now the whole cost.

**The trap.** The first three runs reported that the caret never moved for a
watcher, even after the fix. It would have been easy to write that up as a
deeper product defect. Instrumenting instead of concluding showed the stored
awareness blob was byte-identical before and after, which isolated it to the
writer, and then that Ada's insertion point was 40 before AND after the
keypress: `Home` does not move a textarea's insertion point on macOS. The probe
had been measuring nothing.

The run now asserts `caret-actually-moved` before it asserts any latency, so a
future change to the harness cannot quietly go back to measuring nothing.

## Also open

- **28 further gaps** were confirmed by a 34-agent mapping pass over the collab
  and agent surfaces, adversarially verified, with file:line evidence and a
  proposed smallest fix for each. Worth reading before the next change here.
  Journal: `~/.claude/projects/.../subagents/workflows/wf_edb77668-835/`.
  The ones that bear on this goal: presence and carets render only in edit mode,
  not in the reader; the caret label reads the peer's self-declared name while
  the avatar reads the server-resolved one; an agent's caret is always at the
  end of the body rather than at the section it is editing; `delete_item` has no
  live path, so a human with the item open is not told it was trashed; and
  `hasActiveCoEditors` routes agent writes while counting the agent's own
  presence row.
- **The assistant's model is not exercised.** The run drives the executor the
  assistant uses, not a provider. Choosing the right tool from a sentence is the
  provider's job and needs a real API key, which this run deliberately does not
  carry. That path wants a recorded fixture, not a live key in a test.
- **The `texttext` CLI binary is not invoked.** The run calls
  `POST /api/agent/presence` the way the CLI does, so a regression inside
  `mac/Sources/TextTextCLI` would not be caught here.
- **Timing uses generous windows** (20 to 40 seconds) everywhere except the
  idle-caret check. The run proves a change arrives, not that it arrives
  quickly.
- **The run leaves its two dev-login users and its item in the local database.**
  Repeat runs reuse them.

## Verification

Run from `~/dev/TextText--work` against local Postgres (`texttext_dev`). No
production Neon, no deploy, no release, no scheduled anything.

- `npx tsc --noEmit` clean.
- `npx vitest run`: 104 files, 747 tests, all passing.
- `npm run build` succeeds.
- `npm run eval:collaboration:browser`: 24/24.

## Next concrete step

Review both branches and land them with `merge-gate` from the worktree
(`~/dev/stack/runbooks/workflow.md`). They touch different files and are
independent.
