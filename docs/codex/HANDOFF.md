# Write: current handoff

Updated 2026-07-18.

## Product state

- `main` is the only durable development branch and release source.
- There is no unfinished feature batch or stranded implementation branch.
- Write `0.103`, build `109`, is the current shipped Mac and web release for the
  completed batch.
- Release metadata is authoritative in `src/generated/app-release.ts` and
  `mac/Info.plist`. Check those files instead of relying on version snapshots in
  planning documents.

## Completed scope

The current release includes the batch 4 reader, comments, bookmark chrome,
responsive search, folder-view, Recent-list, native AI, and delivery-reliability
work. Do not redo that scope without a newly reported regression.

The MCP and UI briefs in `docs/codex/` are retained as historical design context.
They are not pending-work registries. Current AI architecture and invariants live
in `docs/ai-sidebar-architecture.md` and `AGENTS.md`.

## Next task

There is no preassigned next task. Continue from the user's latest request. Work
directly on `main`, preserve unrelated changes, verify the coherent unit once,
commit and push once, and ship meaningful product work through the repository's
owner-facing release workflow. Internal documentation-only cleanup does not
require a product build or release.

Before handing off again, update this file only when work is genuinely unfinished.
Completed acceptance criteria belong in commit history and the in-product
changelog, not in a growing list presented as active work.
