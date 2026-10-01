# TextText handoff

## Current work

Finish the [content-first product brief](design/texttext-content-first-ux.md) on ordinary folder workspaces and self-contained TextPacks. The [canonical checkpoint](TEXTTEXT_UX_CHECKPOINT.md) records current HEAD, dirty files to preserve, task-owned processes, verified journeys, and the exact next action. Reconcile it with `git status` and the current listener before editing or restarting anything.

The owner authorized local replacement of `/Applications/TextText.app`. Native 0.202 (1142) is installed against the task-owned localhost server with a signed Codex helper. An actual scoped Codex edit appeared once in the open editor and local/server TextPacks, with a new `external_agent` audit row; the prior human edit has its own `human` audit row. The two-account browser journey and local vault browser fixture passed. A full 240-pack rerun met folder and typing targets but still missed item-open and one Command-K target; see the [checkpoint](TEXTTEXT_UX_CHECKPOINT.md) and [performance receipt](file-vault-performance-2026-09-30.md). A watch-status source fix is committed but not yet installed.

The owner accepts starting fresh instead of recovering deleted Vercel Blob objects. Keep current working TextPacks and unrelated dirty source intact while making new file workflows reliable. Do not assume old Blob images, downloads, or off-box backups can be recovered.

## Blockers and boundaries

- Private Cloudflare R2 media, backups, and release adapters have focused code tests, but no live buckets, upload/read, scratch restore, Oracle switch, or public release. The owner considers the old Blob files disposable. Off-box backups are unavailable since that store was deleted. Local development can proceed independently.
- Oracle is shared with Algorave. Its PostgreSQL, application, and Caddy services use ports 5434, 3500, and 8445; preserve both the Algorave `use_backend` rule and backend in `/etc/texttext/haproxy.cfg`. Before any infrastructure repair, follow the fleet/database references in `AGENTS.md`, check backups/mtimes/running work, and obtain the separate owner authorization it requires.
- The native 1136 conflict flow once preserved both branches but left Retry/reopen on an offline screen. Fix `a09c0fff` is installed in 1137 but still lacks installed conflict/retry proof. Current production deployment and public sign-in have not been verified. No public push, deployment, release, or billing change was performed by this task.
- Build 1142 includes a signed helper and completed one real scoped Codex edit. Snapshot-level audit cannot enumerate every contributor if edits coalesce before one upload. A stale web-connection banner after recovery is fixed in source at `63f654f8` and needs the next installed build.
- Preserve unrelated dirty `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, and `scripts/.probe-editor.ts`. Do not reset, clean, or fold them into a task commit.

## References

- [Architecture and implementation](design/texttext-file-vault-migration.md), [implementation receipt](file-vault-implementation-2026-09-30.md), [reference screens and lessons](design/content-first-reference-notes.md), and [DESIGN.md](../DESIGN.md).
- Focused receipts: [starters](file-vault-starters-2026-09-30.md), [capture/import/search](file-vault-capture-import-search-2026-09-30.md), [articles](file-vault-articles-2026-09-30.md), [reader](file-vault-reader-2026-09-30.md), [images](file-vault-images-2026-09-30.md), [previews](file-vault-previews-2026-09-30.md), [customization](file-vault-customization-2026-09-30.md), [folder views](file-vault-folder-views-2026-09-30.md), [recovery](file-vault-recovery-2026-09-30.md), and [collaboration](file-vault-collaboration-2026-09-30.md). Older installed versions in these receipts are historical evidence.
- Older narrative is in [September 30 history](HANDOFF-history-2026-09-30.md). No project changelog entry is due for an unshipped local build.
