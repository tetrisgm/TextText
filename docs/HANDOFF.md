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
