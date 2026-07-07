# The Codex loop

Codex (the local `codex` CLI, headless) does the bounded build tracks;
Claude (or Ramine) holds schema, security, contracts, merges, review, and
deploys. This file is the queue's state.

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

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | T1-mac-nested-sync | running | SyncEngine/ServerClient nested paths |
| 2 | T2-bookmarks-web | running | FolderPage + bookmark components |
| 3 | T3-mac-capture-openwith | running | CaptureAgent + OpenFileHandler |
| 4 | T4-sharing-workspace-ui | running | 4 island components |
| 5 | public-category-pages | queued | brief not yet written; see docs/PLAN-2026-07-07.md |
| 6 | openapi-sync-actions | queued | OpenAPI file + ChatGPT Actions guide |
| 7 | oauth-connect | queued | needs Claude security review before merge |
| 8 | capture-hardening | queued | PDFs, paywalls, retries |

Update the Status column as tasks move (queued -> running -> review ->
merged / rejected). New briefs go in codex/tasks/, one file per task,
always with a STRICT file-ownership section; that section is what makes
parallelism safe.
