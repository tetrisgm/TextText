# TextText content-first checkpoint

## Goal and settled decisions

Complete the [product brief](design/texttext-content-first-ux.md) on ordinary folder workspaces and self-contained TextPacks. The [file-vault architecture](design/texttext-file-vault-migration.md) is authoritative. The owner authorizes replacing the local `/Applications/TextText.app` with work-in-progress builds. Deleted Vercel Blob objects are disposable; continue from current files instead of recovering them. Preserve active TextPacks and unrelated dirty source.

## Canonical local state (2026-10-01)

- Source: `main` at `31281f03`. `08366635` adds stable natural folder ordering before pagination. `31281f03` keeps editor actions in the contextual vault header and brings the verifier in line with the quiet shell.
- Dirty files owned by other work: `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, and `scripts/.probe-editor.ts`. Do not alter, reset, clean, or commit them.
- Installed app: `/Applications/TextText.app`, version 0.202 build 1146, Apple Development signed. The installer validated the app, three extensions, and `Contents/Helpers/codex`, and confirmed one canonical installed copy. Receipts: `/tmp/texttext-build-1146.log` and `/tmp/texttext-install-1146.log`.
- Local app server: `127.0.0.1:3000`, PID 22454, Codex session 86821, build output `.texttext/vault-perf-20261001k`.
- Server command: `TEXTTEXT_VAULT_ROOT=/Users/shokunin/dev/TextText/.texttext/vault-server TEXTTEXT_NEXT_DIST_DIR=.texttext/vault-perf-20261001k node --env-file=.env.local node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000`.
- No public push, deploy, release, or persistent job was performed.

## Current acceptance evidence

### Folder shell and local editing

- The offline vault browser suite passes the folder shell, creation and capture paths, image paste, reader behavior, recovery, narrow layout, keyboard behavior, light/dark rendering, and reduced motion. Current receipts: `/tmp/texttext-final-local-vault-build.log`, `/tmp/texttext-final-browser-order.log`, and `/tmp/texttext-header-portal-browser.log`.
- Folder-backed collections now use natural path order before pagination, so repeated requests return stable first pages. Focused tests, TypeScript, ESLint, and the full browser fixture passed for `08366635`.
- The contextual header now lays out editor, people/agent, comment, sharing, and overflow controls in document flow instead of covering each other. TypeScript, ESLint, production build, and light/dark visual inspection passed for `31281f03`.

### Collaboration and permissions

`/tmp/texttext-file-collaboration-header-fix-4.log` passes all 26 checks with two signed-in accounts:

- live presence plus comment and reply propagation without reload;
- comments persisted inside the canonical TextPack;
- concurrent edit convergence, writer-scoped undo and redo, and exact canonical bytes;
- offline convergence, separate Web Locks and recovery journals for same-origin tabs, reload recovery, and exact three-editor convergence;
- one presence POST and zero repeat content mutation uploads during the idle check;
- creation of a folder and note, followed by discovery and open from the second account without reload;
- permission downgrade enforcement and notice in the open editor;
- zero browser runtime errors.

Visual receipts: `/tmp/texttext-file-collaboration-light.png` and `/tmp/texttext-file-collaboration-dark.png`.

### Performance and memory

The final 240-pack production benchmark on source `08366635` passed its bounded harness and exact cleanup. It verified two accounts, all six external direct writes in the already-open editor, zero blocked external requests, and no repeat collaboration uploads during ten idle seconds. Raw evidence: `/tmp/texttext-vault-perf-sGvfUt/result.json`.

| Measure | Final observation | Initial target status |
| --- | ---: | --- |
| Cold / warm first visible heading | 748.1 ms / 568.4 ms p95 | Reported |
| Folder navigation p95 | 104.1 ms | Narrow miss against 100 ms |
| Item / cached item navigation p95 | 605.9 / 590.9 ms | Cached item misses 100 ms |
| Input to two visible frames p95 | 13.8 ms | Meets 50 ms |
| Command-K samples | 108.5, 19.6, 23.9 ms | Cold call misses 100 ms; warm calls meet it |
| Server / browser peak RSS | 220.1 / 682.7 MiB | Within harness bounds |
| Browser RSS after close | 144.3, 148.1, 130.6 MiB | Ends lower; three rounds do not prove leak absence |
| Idle CPU, server / browser | 0.06% / 0% | Reported |
| Ten-second editor idle network | one presence POST; zero collaboration POSTs | No content-upload spam |

See [performance receipt](file-vault-performance-2026-09-30.md) for conditions and limits.

### Native application

- Build 1146 is the canonical local app and opens the folder workspace with the quiet shell and contextual header.
- The build and install gates passed. The installer cannot read the sandbox-private runtime health report for this local Apple Development build, so helper validation is packaging evidence rather than a live provider operation.
- Earlier installed builds proved a real scoped Codex edit, same-note human/agent convergence, correct human/external-agent audit attribution, template customization, image gallery navigation, RSS keep flow, and focus on new-note creation. Those remain supporting evidence, not a substitute for final build 1146 checks.

## Remaining acceptance and external boundaries

1. Finish build 1146 installed-app checks: restore online state if the current Offline banner persists, verify New note focus and typing, exercise the installed Add agent path, then show an outage banner and verify it clears automatically after the task-owned server returns.
2. Profile cached item open only if the product decision still requires the initial 100 ms target. The measured p95 is 590.9 ms; do not claim it as met.
3. Live private R2 upload/read, backup restore, Oracle switch, public deploy/appcast, public sign-in, and production external-agent authorization remain unverified. The deleted Blob data is intentionally out of scope.
4. Keep `/Applications/TextText.app` usable while its local server is needed. Recheck the listener before cleanup. Stop the isolated benchmark Postgres only after no verifier depends on it; never stop the normal local database.

## References

- [Handoff](HANDOFF.md), [performance receipt](file-vault-performance-2026-09-30.md), [implementation receipt](file-vault-implementation-2026-09-30.md), [collaboration receipt](file-vault-collaboration-2026-09-30.md), [recovery receipt](file-vault-recovery-2026-09-30.md), and [AI sidebar architecture](ai-sidebar-architecture.md).
- Other focused receipts remain under `docs/file-vault-*-2026-09-30.md`. Historical process IDs and installed versions are evidence only, not live state.
