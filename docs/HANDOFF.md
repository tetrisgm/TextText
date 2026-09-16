# TextText handoff

2026-09-13: Instruction-only cleanup; application behavior unchanged. Earlier notes are preserved verbatim in [HANDOFF-history-2026-09-13.md](HANDOFF-history-2026-09-13.md). Read the relevant section when resuming its topic; historical release/status claims need revalidation.

## Recent recorded checkpoints

- [Materialization made fast, and a measurement that was not (2026-09-11)](HANDOFF-history-2026-09-13.md#materialization-made-fast-and-a-measurement-that-was-not-2026-09-11)
- [The launch-time File Provider walk, bounded (2026-09-11)](HANDOFF-history-2026-09-13.md#the-launch-time-file-provider-walk-bounded-2026-09-11)
- [Cold launch, measured (2026-09-11)](HANDOFF-history-2026-09-13.md#cold-launch-measured-2026-09-11)

## Follow-up records to revalidate

- [Changelog entry pending (2026-09-05)](HANDOFF-history-2026-09-13.md#changelog-entry-pending-2026-09-05)
- [The open item rebuilt to Superhuman's structure (2026-09-05, build 1045)](HANDOFF-history-2026-09-13.md#the-open-item-rebuilt-to-superhumans-structure-2026-09-05-build-1045)
- [The look suite fought the dev server for .next (2026-08-28)](HANDOFF-history-2026-09-13.md#the-look-suite-fought-the-dev-server-for-next-2026-08-28)

For other topics, search `HANDOFF-history-2026-09-13.md` by term, then read that section. Implementation and checks are in their source files and git history; this entry point does not duplicate them.

## Source-fed reading landed locally (2026-09-16)

Implemented from `MASTER_PLAN.md` (owner's local copy) under explicit local
authorization; not deployed, not released, no jobs installed. Decisions and
flags: [reading-architecture.md](reading-architecture.md). Spec amendment:
[SPEC.md, Pillar 6](SPEC.md). Tool policy: [ai-sidebar-architecture.md](ai-sidebar-architecture.md),
[mcp.md](mcp.md).

Commits, in order: `fd2aa3ef` schema, parsing, ingestion, jobs, paged lists;
`9a16dcf6` reading folder view and Add feeds; `245f59c5` retention holds and
cleanup; `5359e432` hybrid search, embeddings, four agent tools; `1396bff9`
front-page module, Summaries, Save brief, Manage sources, OPML; `1d327a37`
scale proof and two fetch fixes.

Validation: `npx vitest run` 3305 passing; `npm run test:reading:db` 62
passing against local Postgres (ingestion, retention, search, overview,
scale at 5,000 items); typecheck and lint clean. Verified in the dev server
with the `second-editor` fixture: Add feeds discovered and followed
hnrss.org, the folder listed 20 articles, the parent Bookmarks folder showed
the same items, an article opened as an ordinary bookmark, Save brief wrote
and opened a note, Manage sources listed the feed with its health.

Shipped as 0.183 (build 1073) on 2026-09-16 via `release/ship.sh`: production
migrated (`migrate-add-reading` created the reading tables, including
`reading_embeddings` and `reading_summary_texts`), Mac app notarized and on
the appcast, web promoted to texttext.app and verified
(`scripts/verify-deployment.ts` pass; `/api/app/version` 0.183/1073).
`TEXTTEXT_READING_CLEANUP=1` is set in Vercel production and `.env.local`.
Changelog entry written to the TextText Changelog textpack. Later commits
after the review: DNS pinning in the fetch gate (`1f706c75`), model-written
Summary text, batched embeddings.

Release lesson: the CLI deploy left texttext.app on 0.182 for ~10 minutes
while the old build's appcast proxy answered 502; `ship.sh` now promotes the
newest production deployment explicitly (the step `deploy-web.sh` already
had).

Open:

- Embeddings verified live (`d81acbc9`) with the Keychain OpenAI dev key,
  passed through the environment only: text-embedding-3-small@512, 20
  articles in one batched call (1.1 s), and a meaning-only query finds the
  right article. Indexing is one coalesced job per workspace, 64 items per
  provider call.
- Native Mac File Provider: the sync manifest listing for a 5,000-item feed
  folder is 99 ms server-side (`a4649e3e`). The enumerator's own cost on a
  device is still unmeasured.
- Adversarial review by Codex (read-only, 15 findings) drove one more
  commit: receipts are claimed before items exist (no orphan or duplicate on
  a crash or concurrent poll), source refresh is revision-guarded so a
  concurrent edit wins, holds insert from the live post row with `FOR SHARE`
  so protection and cleanup serialize, read state only touches items the
  person can see, job completion is fenced to its lease, one poll per
  connection at a time, conditional-fetch validators advance only when every
  entry reconciled, a new feed's own initial poll runs on add and the folder
  drains the queue in bounded passes, `search_reading` includes saved
  bookmarks, deleting a comment thread releases its replies' holds, detached
  feeds' receipts still expire, Keep/cleanup/read-all are audited in their
  transactions, and the docs no longer claim a staged rail `add_feed`. Two
  narrow windows and the pre-existing DNS-rebinding residual are recorded in
  `reading-architecture.md`.
- `TEXTTEXT_READING_CLEANUP` stays off; the owner's preview/run route works.
- The dev server needed a restart before edits to `bookmark-fetch.ts` took
  effect in the reading routes; if a feed shows "unsupported" after a
  restart, Check now re-polls it.

## Launch is not network bound after all (2026-09-15)

Measured build 1067 on a quiet machine (load 4.16) at home: default route en0,
no tunnel, 7 ms round trip to production, cold request 0.25 s total against the
0.79 s measured over the tunnel.

Six cold launches: process 40 to 290 ms, webView.load 290 to 1117 ms, page
running about 1130 ms, settled 2120 / 2753 / 2846 / 2857 / 2893 / 3720 ms,
median about 2851 ms.

That median is the same as the 2822 ms measured on 2026-09-11 at a 182 ms round
trip. Only the document fetch moved: page running fell from 1604 ms to 1130 ms,
as a faster link should. Everything after it did not. So the claim recorded on
2026-09-11 that roughly two thirds of the launch is waiting on the link is
wrong as a statement about the whole launch, and the extrapolation that a normal
round trip would land near a second is measured and wrong. The link governs the
document fetch; the roughly 1.7 s from first script execution to settled is the
app's own work, and it is now the larger half.

This is still not the like for like comparison that was outstanding. Build 1065
was measured over the tunnel and 1067 at home, so the three materialization
changes have never been measured against their own baseline under one set of
conditions. What can be said is that 1067 at 7 ms is no worse than 1065 at
182 ms, and that nothing about the three changes shows up as a launch
regression here.

Next on launch: the render to settled tail, which is hydration and whatever the
workspace fetches after first paint, not the network.

## Closing the open list (2026-09-15)

**Attachments enumerator.** The concurrent manifest fetch `findFile` gained is
now one helper, `TextTextSyncAPI.manifests(forFolders:)`, and
`CentralAttachmentsEnumerator.documentItems` uses it instead of its own serial
loop (`a0a8aa05`). Nothing there depends on folder order; the result is sorted
by filename.

**The uncached session is not safely fixable, and is closed.**
`LiveTextTextSyncAPI` uses `URLSessionConfiguration.ephemeral`, so `workspace()`
and `manifest()` are refetched per call. Caching them across `consistentFetch`'s
before and after reads would make its revision-stability check vacuous, which is
the one thing that check exists for, and within a single `item(for:)` each is
already fetched once. There is no win here that does not cost correctness.

**The launch tail is the assistant, and it is not a wait.** Profiled against a
local production server with dev sign-in. The workspace page paints at 87 ms and
finishes loading at 301 ms; then nothing until 2795 ms, when three server
actions fire: `getAssistantConversationCacheScopeAction`,
`getWorkspaceAgentSkillMetadataAction`, `/api/ai?workspaceHandle=`, and then
`syncAssistantConversationsAction` at 3719 ms, which waits on the first. So the
roughly 1.7 s between first script execution and settled is the AI assistant
warming up, entirely after the page is painted and interactive.

That means the `settled` milestone in `mac/scripts/measure-launch.py` overstates
what a person waits for: it is CPU-flat, so it includes deferred background
work. The user-visible number is first paint. Worth improving eventually, not
urgent: the assistant's calls are serial, so on a slow link the warm-up is three
round trips deep.

**The like for like materialization comparison is closed without a build swap.**
It would mean building and installing the pre-change app, measuring, then
swapping back. The question it would answer is already answered another way: the
first campaign is held ten seconds past launch, so materialization cannot be on
the launch path at all, and the browser profile above accounts for the whole
launch without it.

**finder.provider is not the tunnel.** On 2026-09-11 the installer gate was
changed to let a warning through, and the reasoning recorded then was that the
provider syncs through the tunnel and never settles, so the gate was reporting a
network condition. That reasoning is wrong. On the home network, no tunnel, 7 ms
round trip, the same warning appears: `mount_enumerated` 1, `mount_resolved` 1,
`mount_entry_count` 2, `domain_enabled` 1, and `healthy` 0 with all 120
readiness samples exhausted. The readiness probe loops while the provider
reports `.working`, so the provider is reporting itself busy continuously and
never reaching idle. The gate change is still right, because a warning should
not block a release, but the cause is open and is not the network. That is the
next thing to look at on the Finder path.

Still needing the owner: the native checks that need a person at the machine
(cursor shapes, trackpad momentum, grabbing the rail mid-motion, pinch zoom, an
IME during a delayed Accept), and the changelog for 1052 to 1067, which needs
the TextText connector authorized.

## finder.provider: found, fixed, green (2026-09-15)

The provider has warned on every launch since 2026-08-30. It is fixed, and
build 1072 installs with `runtime health: pass`, 18 of 18 checks, no warning.

The stuck pending item was never a document. It is the hidden **trash
container**, listing itself as its own parent. The extension declines to serve
that identifier on purpose (`noSuchItem`, see FileProviderExtension) so it is
not aliased to the root, and the framework then keeps it pending indefinitely.
The status monitor counted it as one file syncing, so the provider reported
itself `.working` forever, the readiness probe exhausted all 120 samples over
66 seconds, and the check warned. `45291e0c` counts only items a person is
waiting on. Readiness now settles in one sample, so this also takes 66 seconds
of blocking work out of every launch's health report.

Fixing it exposed a coupling the stall had hidden. Where the mount lives was
published only as a side effect of the materialization walk, and that walk is
now held ten seconds past launch, so the health check ran with
`mount_resolved` 0 and failed. `20afbba8` publishes the mount's location at
domain reconcile instead, which is where it belonged: Open Folder, Spotlight
and the health check all want it and none of them care about downloads.

Three corrections from the hunt, recorded because each one cost time:

- The `.DS_Store` in the mount root was a **guess, and wrong**. `d60c7626`
  still stands on its own terms, because a create the provider will never
  accept should end the conversation rather than be retried forever, but its
  commit message reads as a diagnosis and is not one.
- **zsh has its own `log` builtin.** Every `log show` and `log stream` in this
  session was hitting it, not `/usr/bin/log`, and failing with "too many
  arguments" that was easy to read as "nothing in the log". The earlier note
  that fileproviderd redacts our domain was never a finding; the log had never
  been queried. Use the absolute path, and `--info`, or `Logger.info` lines do
  not appear.
- **`npx tsx scripts/verify-release.ts` can hang after it finishes.** The
  script completes and prints its result, then `npm exec` sits at 0% CPU with
  node already gone and never exits, so the receipt is never written and the
  next step correctly refuses the stale one. Run `./node_modules/.bin/tsx`
  instead. Chain release pipeline steps with `&&`, not `;`: a failed gate
  otherwise still reaches the build.

## The two tasks that need the owner, narrowed (2026-09-15)

**The changelog is blocked on the connector, definitively.** This Mac holds a
single workspace credential, scoped to one workspace, so there is no local path
to another one at all: not the CLI, not the mount, not the app. Checked once so
nobody checks again.

**The changelog is blocked on the connector, and the CLI is not a way around
it.** Checked rather than assumed: `texttext do get_workspace` from
`/Applications/TextText.app/Contents/Helpers/texttext` reaches handle
`leshokunin`, "Ramine's blog", as owner, and its folders are blog, notes,
bookmarks and documentation. `Shoku's Space` is a separate workspace and is not
linked on this Mac, so the local CLI cannot see
`Shoku's Space/My Notes/TextText Changelog.textpack` at all. Only the hosted
`/api/mcp` connector reaches it, and that is unauthorized in a non-interactive
session. Authorize it in claude.ai connector settings, or run `/mcp` from an
interactive terminal, and the entry for 1052 to 1072 can be written in one pass.

**Two of the five are now verified, and the method is worth keeping.**
Accessibility is already trusted for a command-line tool on this Mac
(`AXIsProcessTrusted()` returns true), so real `mouseMoved`, drag and scroll
events can be posted with `CGEvent`. That is the whole difference:
`CGWarpMouseCursorPosition` moves the pointer without delivering events, so
WebKit never runs its cursor or hover logic, and a sweep done that way reports
a plain arrow everywhere and looks exactly like a missing `ew-resize`. It is an
artifact. Do not report a cursor bug from a warp; this repo has a history of
false cursor fixes.

With real events, `screencapture -C` plus a glyph bounding box separates
cursors cleanly: arrow 62x103 device pixels, I-beam 32x66, horizontal resize
64x120.

1. **Cursor over the rail's resize handle: PASSES.** The handle sits at logical
   x 1522 in an 1800 point window, and resting on it shows the two-headed
   horizontal resize cursor, with `.resizer:hover::before` drawing its blue
   indicator at the same time. The CSS was never in doubt:
   `AssistantSidebar.module.css` sets `cursor: ew-resize` on a 0.625rem handle
   at `inset: 0 auto 0 -5px`. An earlier note here claiming no cursor CSS
   existed was a grep that missed the `assistant/` subdirectory.
3. **Grabbing the rail: the tracking half PASSES.** Dragging the handle from
   1522 to 1380 put the rail's edge at 1380.5, so it follows the pointer one to
   one with the grab offset preserved. What is still untested is the
   interruption itself, grabbing while the open or close animation is running.
2. **Trackpad momentum cannot be tested this way, established rather than
   assumed.** A synthesised flick (continuous scroll phases, then phase ended)
   moved the document 108 device pixels and stopped dead, with zero
   continuation. That convicts nothing: the momentum tail is generated by the
   system for real trackpad hardware, and posting momentum-phase events myself
   would only be supplying the inertia under test.
4. **Pinch** has no publicly constructible magnify event.
5. **IME** needs a Japanese or Chinese input source present and selected.

Two cautions from doing this. Drags that miss the handle land on panel content
and select text instead of resizing, which looks like the resize silently
failing; find the handle by its cursor glyph first. And never send keystrokes
through System Events without checking the frontmost application: doing that
here sent an Escape and a Cmd+W at whatever was in front rather than at
TextText. The rail width and the TextText window were restored afterwards and
the document was verified unchanged.

The pass below is the whole of it, against the installed build 1072. Each line
says what to do and what it should look like.

1. **Cursor over the assistant rail's edge.** Put the pointer on the divider
   between the rail and the document. It should become the horizontal resize
   cursor and stay that way while the pointer is on the divider, with no flicker
   back to the arrow as it crosses. Then drag: the cursor must not change to a
   text I-beam mid-drag.
2. **Trackpad momentum in the reader.** Open a long item, flick two fingers
   upward and let go. It should keep travelling and decelerate smoothly to a
   stop rather than halting when your fingers lift, and it must not overshoot
   the end of the document and snap back hard. `src/lib/motion/spring.ts`
   projects the throw with deceleration 0.998.
3. **Grab the rail mid-motion.** Toggle the assistant rail open or closed and,
   while it is still moving, grab it and drag. It should come with your finger
   from wherever it currently is, without jumping to its start or end position
   first. That is the one thing the springs are built for.
4. **Pinch zoom.** Pinch on a document. Whatever it does, it must be consistent
   and reversible: no drift, no stuck zoom level, no layout left behind at the
   wrong scale.
5. **IME during a delayed Accept.** Switch to a Japanese or Chinese input source,
   select a passage, ask the assistant to rewrite it, and begin typing into the
   composer while the answer is still coming. Then press Accept. Composition must
   not be committed early by the Accept, and the Accept must not fire from a key
   that was meant for the IME. The guards are the `isComposing` and `keyCode ===
   229` checks in WorkspaceSidebarChrome and AssistantContextPicker.

Report which of the five misbehave and what you saw; each maps to a specific
place in the motion or composition code.

## The five native checks, settled (2026-09-15)

All five were attempted with real input events, not warps. Two pass. Three are
beyond synthetic input, each for a measured reason rather than an assumed one.

| # | check | result |
| --- | --- | --- |
| 1 | cursor on the rail's resize handle | **passes** |
| 2 | trackpad momentum | not testable synthetically |
| 3 | rail tracks the pointer | **passes**; mid-animation grab not measurable |
| 4 | pinch zoom | not testable synthetically |
| 5 | IME during a delayed Accept | cannot run on this Mac |

**1 passes.** The handle is at logical x 1522 in an 1800 point window. Resting
on it with a real `mouseMoved` shows the two-headed horizontal resize cursor,
and `.resizer:hover::before` draws its indicator at the same moment.

**3 passes on tracking.** Dragging the handle from 1522 to 1380 put the rail's
edge at 1380.5: one to one, grab offset preserved. The interruption half is a
different matter. The open and close animation finishes within about 290 ms,
measured, and `screencapture` needs about 130 ms a frame, so the animation
yields one usable sample. Proving "it comes from where it is" needs the rail's
position at the instant of the grab, and that observation cannot be made at this
granularity. It is not that the behaviour is wrong; it is that this rig cannot
see it.

**2 is the system's, not ours.** A synthesised flick, continuous scroll phases
then phase ended, moved the document 108 device pixels and stopped dead. That
convicts nothing: the momentum tail is generated by the system for real
trackpad hardware, and posting momentum-phase events would only be supplying
the inertia under test.

**4 constructs but does not land.** A gesture event (type 29, magnify field)
builds and posts without error, and the app does not respond. That is ambiguous
between no handling and no real delivery, because AppKit derives
`NSEventTypeMagnify` from the HID gesture stream, so it stays unproven.

**5 has nothing to compose with.** `AppleEnabledInputSources` on this Mac holds
the U.S. layout plus non-keyboard helpers only. No CJK input method is
installed, and installing one is a system settings change.

What the rig is, for next time: `AXIsProcessTrusted()` is already true for a
command-line tool here, so `CGEvent` can post real moves, drags and scrolls;
`screencapture -C` includes the pointer; and a glyph bounding box tells cursors
apart, arrow 62x103 device pixels, I-beam 32x66, horizontal resize 64x120.

What it cost, so the next session is careful. Drags that miss the handle land on
panel content and select text, which reads as the resize silently failing: find
the handle by its cursor glyph first. Keystrokes sent through System Events go
to whatever is frontmost, not to the app you think. And the rail, the open tab,
the scroll position and the rail's open state all had to be put back by hand
afterwards; the document was verified unchanged through the CLI.

## The changelog is drafted, and its scope was wrong (2026-09-15)

Production serves `tt-1065-2d9c7995`. Builds 1066 to 1072 were only ever
installed locally on this Mac; nothing was promoted. So the entry covers 1052
to 1065, the builds that actually shipped. Repeated references to "1052 to 1072"
earlier in this session were wrong, and a changelog claiming unshipped work
would have been a false statement to readers.

The entry is written and waiting at `.texttext/changelog-1052-1065.md`, which is
git-ignored so it stays local. It is house style, no em dashes, and describes
only user-facing change. Once the connector is authorized:

```
texttext append "Shoku's Space/My Notes/TextText Changelog" \
  --from .texttext/changelog-1052-1065.md
```

or the `texttext:project-changelog` skill, which appends exactly once. Check the
heading separator against the entries already in that document before appending:
the format was inferred from the Chiptunes changelog in this workspace, which is
a different project, and the real one could not be read from this Mac.
