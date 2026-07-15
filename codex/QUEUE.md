# The Codex loop

Codex (the local `codex` CLI, headless) does the bounded build tracks;
Claude (or Ramine) holds schema, security, contracts, merges, review, and
deploys. This file is the queue's state.

Current project status is NOT tracked here. See `docs/app-health.md`,
`docs/mcp.md`, and `docs/ai-sidebar-architecture.md` for the shipped
architecture, and the release commits for what has landed.

## How to run

```sh
codex/run-task.sh <task-name>            # one task, isolated worktree
```

Tasks whose briefs declare DISJOINT file ownership may run in parallel
(separate terminals or `&`). After a task finishes:

1. `git -C ../write-codex/<task> diff main` and REVIEW ADVERSARIALLY
   (Codex self-reports are optimistic; the diff is the truth).
2. Merge: `git merge codex/<task>` (ownership boundaries make these
   conflict-free when respected).
3. Verify ladder: `npx tsc --noEmit && npx vitest run && npm run build`,
   plus `swift build --package-path mac` when mac/ changed.
4. `git worktree remove ../write-codex/<task>` once merged.

## Queue

_Empty._ The July 7, 2026 batch (nested sync, bookmarks web, capture
open-with, sharing UI, category pages, OpenAPI/ChatGPT actions, OAuth
`/connect`, capture hardening, folder-tree sidebar, category chip) all
shipped in v0.74; its briefs live in `codex/tasks/` as historical records,
and the plan is archived at `docs/archive/2026-07-07-plan.md`.

| # | Task | Status | Notes |
|---|------|--------|-------|
| - | _(none queued)_ | | |

Add a new brief in `codex/tasks/`, one file per task, always with a STRICT
file-ownership section (that section is what makes parallelism safe), then
add a row above and move it queued -> running -> review -> merged / rejected.
