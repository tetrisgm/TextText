# Write: current continuation state

Updated 2026-07-18.

## Status

There is no unfinished continuation batch. The work previously tracked here as
batch 4 is implemented, verified, committed to `main`, and shipped.

Completed behavior includes:

- Apple Foundation Models prewarming and bounded preparation retries.
- Normal reader text selection without starting the workspace marquee.
- Comments created from selected text and rendered as inline threads.
- Bookmark recapture in the edit menu, source captions, and Reader or Full views.
- One responsive search control across root, folder, and item views, including
  find-in-item highlighting.
- Updated One Column and Cards folder views.
- Immediate removal of trashed items from Recent.

## Release snapshot

The completed batch shipped as Write `0.103`, build `109`. The authoritative
release metadata is in `src/generated/app-release.ts` and `mac/Info.plist`; do
not copy version numbers from this document into a release command.

## Continuing work

Start new work from the user's latest request on clean `main`. Follow `AGENTS.md`,
`CLAUDE.md`, `DESIGN.md`, and `docs/ai-sidebar-architecture.md`. The files
`docs/codex/mcp-brief.md` and `docs/codex/ui-batch-brief.md` are historical design
references, not active task lists.

Do not infer pending work from older acceptance criteria or release incidents.
If no newer user request exists, there is no queued implementation work.
