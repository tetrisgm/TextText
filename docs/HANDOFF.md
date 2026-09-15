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
