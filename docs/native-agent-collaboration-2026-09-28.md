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

On 2026-09-29, `scripts/verify-second-person-agent-boundary.ts` used the
existing second collaborator's own authenticated local session. That account
opened the owner's shared test note, but the owner's AI configuration appeared
disabled to it. Assistant-turn and `append_to_item` requests against the owner
workspace both returned 403 before a provider call or write. A fresh store
read found the note's body and revision unchanged. This proves the local HTTP
owner boundary for this fixture; it does not test every native agent provider
or a public deployment. The script, TypeScript, and touched-file ESLint passed.

Reviewed Apply/Undo had a separate late-continuation gap: it could finish an
asynchronous item read after an owner/workspace change and reach its write call.
It now checks the captured owner scope after each preparation read and clears
the scope when the component unmounts. Three focused suites passed 63 tests;
TypeScript and touched-file ESLint passed. This is a guarded code path, not yet
a reproduced live race or proof of cancellation during an already sent write.

In installed build 1112, a bounded read-only Anthropic request on the existing
`Typing benchmark 7d924acf` note reached **Thinking**. Clicking **Stop
assistant** returned the assistant to ready, showed a stopped message with
**Retry message**, and no late answer appeared after six seconds. A fresh
local store read before, immediately after, and six seconds after cancellation
had the same revision (`492385`) and SHA-256 body hash
(`24afd85ab778b1049ccf701575f04063b1a3df4c65d49580f8704f5b8e322c21`).
This is a live API-provider read-only cancellation proof; it does not establish
what happens to an in-flight write or to native account setup cancellation.

## Reviewed rewrite Undo after later writing

On 2026-09-29, a real Anthropic selection rewrite was accepted in the
installed Mac app. After a separate human line was saved below it, **Undo**
refused with “The passage changed. Undo would overwrite newer text.” The
passage itself had not changed. The preview controller was comparing the
entire body to its post-apply snapshot, which treated unrelated later writing
as a conflict.

Undo now checks the exact generated slice before issuing a guarded text edit;
edits outside that slice remain in the body. Oversized generated passages
retain the conservative whole-field check because their commit-time guard
uses a whole-field precondition. The focused preview suite passed 55 tests,
including preservation of later writing and refusal when the generated slice
itself changes; TypeScript and touched ESLint passed.

The installed app then accepted a shorter Anthropic rewrite of the same first
sentence. A separate line, `Human after revised rewrite check c30be3a2.`,
was saved afterward. **Undo** showed **Undone** and **Saved**; both the native
editor and a fresh local canonical-store read had the original first sentence
and the later line. The earlier `Human concurrent ffaec5c4.` line also remained
complete. This proves one local native Undo with a later edit after the target
passage; it does not prove cancellation of an in-flight agent write or every
two-person race.

## Same-passage conflict after an agent preview

On the installed Mac app, a real Anthropic rewrite of the first sentence
reached **Ready**. Before accepting it, the human replaced that exact sentence
with `Two people co-editing this local test note.`. The preview immediately
changed to **The passage changed** and removed its Accept action. The note
showed **Saved**, and a fresh local canonical-store read at revision `492629`
contained the human sentence, not the agent suggestion. The later human line
from the Undo test also remained. This proves one local same-passage conflict
before approval; it does not cover a write already sent or a remote editor
changing the same passage at the approval instant.

Two fresh previews of the unchanged saved passage had reported stale just
after the previous Undo. Reopening the exact saved route cleared that state;
the later conflict preview then generated normally. A subsequent preview
after the human edit also reached Ready without a reload. The intermittent
post-Undo false stale result needs diagnosis; these observations do not show
its cause or prove a general recovery path.

## Targeted Undo revision fence, September 29 follow-up

A new real Anthropic rewrite in installed local build 1113 saved the exact
generated sentence, yet immediate and delayed **Undo** both claimed the
passage had changed. Local diagnostics confirmed the current editor slice
equaled the generated slice. The rejection came after the write was sent:
the selection envelope's old revision was still used as an atomic database
fence even though the target range was unchanged. The same old-revision rule
also ran during server selection validation.

Bounded text edits now validate the exact selected range at the server and
use the revision read with the live document for the atomic append. The live
Yjs version fence and text-range compare still reject a changed target;
caret and Undo source hashes still reject a changed full body, while explicit
source preconditions retain their revision check. After
this change, **Undo** on the still-open native preview reached **Undone**. A
shorter rewrite had been applied and the later body text remained. The
scratch note's first sentence was restored to its pre-check wording, showed
**Saved**, and survived a route reload. Five focused suites passed 149 tests
and TypeScript passed. This verifies the specific false Undo conflict; a
fresh-preview stale result immediately after Undo and remote approval-time
conflicts still need separate live checks.

## Fresh preview immediately after Undo

The installed app reproduced the second failure: after a successful
rewrite and Undo, a new preview of the restored sentence immediately showed
**The passage changed** even though the selected range still matched. The
editor's published revision advanced while the preview was starting, and
the cloud assistant route rejected the old selection revision before
generation. The client also treated revision drift as a changed passage.

The preview now keeps a non-caret selection when its exact range is intact;
the cloud route validates that same range before sending it to the provider.
Caret previews still require their original revision in the client and a
matching full-body hash at the server. A changed selected range still goes
stale, and the reviewed write retains its commit-time range and live-version
guards. In the installed app, a real rewrite reached **Ready**, was accepted,
and reached **Undone**. Without a route reload, a fresh preview of the
restored sentence reached **Ready**; it was discarded without editing. The
scratch note showed **Saved**. This proves one local native sequence, not
all concurrent network timings or a public release.

## Same-passage change from a second live editor

On 2026-09-29, the installed Mac app held a real Anthropic rewrite at
**Ready** for the first sentence of the private local test note. A separate
signed-in browser session then replaced that exact sentence and reached
**Saved**. The Mac editor received the replacement without reloading. Its
preview changed to **The passage changed**, with **Discard** available and
no **Accept** action. A fresh canonical-store read at revision `492644`
contained the browser sentence and the original Typing marker, not the
previewed rewrite. The browser then restored the original sentence; both
editors showed it saved, and a store read at revision `492645` confirmed the
restoration and marker. The stale preview was discarded and the temporary
browser tab closed.

This proves a remote session changing the selected passage before approval is
protected in the installed app. Both sessions used the existing local owner
account; the separate-collaborator access boundary is covered elsewhere.
An edit arriving in the narrow interval after **Accept** starts but before
the server commits still needs a deliberately timed live check.

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
