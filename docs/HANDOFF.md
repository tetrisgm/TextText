# TextText handoff

## Current work

Finish the [content-first product brief](design/texttext-content-first-ux.md) on ordinary folder workspaces and self-contained TextPacks. The [canonical checkpoint](TEXTTEXT_UX_CHECKPOINT.md) is the operational status. The [file-vault architecture](design/texttext-file-vault-migration.md) governs storage and sync.

Current source is `main` at `31281f03`. `08366635` made folder pagination deterministic with natural path order. `31281f03` moved editor actions into the vault header and updated the exact two-account verifier. No public push, deployment, or release was performed.

The owner authorized local replacement of `/Applications/TextText.app`. The sole installed copy is native 0.202 build 1146, Apple Development signed with three extensions and the bundled Codex helper. It targets the task-owned production build on `http://localhost:3000`. Build and install receipts are `/tmp/texttext-build-1146.log` and `/tmp/texttext-install-1146.log`.

## Verified state

- The exact two-account collaboration journey passes presence, comments stored in the canonical TextPack, concurrent edits, scoped undo and redo, offline and reload convergence across three editors, independent same-origin recovery journals, idle upload behavior, folder and note discovery without reload, permission downgrade, and zero browser runtime errors. Receipt: `/tmp/texttext-file-collaboration-header-fix-4.log`. Light and dark screenshots: `/tmp/texttext-file-collaboration-light.png` and `/tmp/texttext-file-collaboration-dark.png`.
- The final offline vault browser fixture passes after the natural folder ordering change. Receipts: `/tmp/texttext-final-local-vault-build.log`, `/tmp/texttext-final-browser-order.log`, and `/tmp/texttext-header-portal-browser.log`.
- The latest full 240-pack production benchmark passes its bounded harness, two-account access, six visible external file mutations, exact cleanup, idle-content-upload check, and memory bounds. Typing meets its initial target. Cached item open remains well above target; folder and cold Command-K narrowly miss. See [performance receipt](file-vault-performance-2026-09-30.md).
- Canonical `/Applications/TextText.app` is version 0.202 build 1146. The installer validated the app, all extensions, and helper, then launched one canonical copy. Final installed connectivity, agent, and visible outage recovery checks are still in progress and must not be inferred from browser acceptance.

## Live local state

- Task-owned Next server: `127.0.0.1:3000`, PID 22454, Codex session 86821, output `.texttext/vault-perf-20261001k`.
- Command: `TEXTTEXT_VAULT_ROOT=/Users/shokunin/dev/TextText/.texttext/vault-server TEXTTEXT_NEXT_DIST_DIR=.texttext/vault-perf-20261001k node --env-file=.env.local node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000`.
- No persistent build, release, reinstall, or server job was installed. Recheck listener identity before stopping anything.
- Preserve unrelated modified `src/components/workspace/assistant/attachments.ts`, modified `src/lib/workspace/__tests__/tabs.test.ts`, and untracked `scripts/.probe-editor.ts`. Do not reset, clean, or include them in task commits.

## Blockers and boundaries

- Private Cloudflare R2 media, backup, and release adapters have code tests only. No live bucket, upload/read, scratch restore, Oracle switch, appcast, or public deployment is verified. The deleted Vercel Blob media, builds, and backups are disposable by the owner's direction; do not spend time recovering them.
- Current public sign-in and production external-agent authorization are unverified. Keep local work independent of those external systems.
- Oracle is shared with Algorave. Preserve its PostgreSQL, app, Caddy ports and both Algorave HAProxy entries. Infrastructure changes require the checks and separate authorization in `AGENTS.md`.
- Performance misses are recorded evidence, not blockers to local feature work. Do not claim the 100 ms cached-item target or a proven absence of memory leaks.

## References

- [Canonical checkpoint](TEXTTEXT_UX_CHECKPOINT.md), [performance receipt](file-vault-performance-2026-09-30.md), [implementation receipt](file-vault-implementation-2026-09-30.md), [architecture](design/texttext-file-vault-migration.md), and [DESIGN.md](../DESIGN.md).
- Focused receipts are linked from the checkpoint. Historical narrative is archived in [September 30 history](HANDOFF-history-2026-09-30.md).
- No project changelog entry is due for this unshipped local build.
