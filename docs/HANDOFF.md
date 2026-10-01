# TextText handoff

## Current work

Finish the [content-first product brief](design/texttext-content-first-ux.md) on ordinary folder workspaces and self-contained TextPacks. The [canonical checkpoint](TEXTTEXT_UX_CHECKPOINT.md) records current HEAD, dirty files to preserve, task-owned processes, verified journeys, and the exact next action. Reconcile it with `git status` and the current listener before editing or restarting anything.

The owner authorized local replacement of `/Applications/TextText.app`. Native 0.202 (1141) is installed against the task-owned localhost server built from the latest source. Its reader source link, four-image gallery Escape/focus behavior, and native human edit were checked; a new `human` audit row and exact local/server TextPack line confirm the attribution fix. The two-account browser journey and local vault browser fixture passed. Connect Codex currently fails because build 1141 omitted the signed bundled helper required by the sandboxed Store-shaped app; a packaging guard and new local build with the existing Codex runtime are in progress. The 240-pack performance run still misses folder/item navigation targets; see the [checkpoint](TEXTTEXT_UX_CHECKPOINT.md) and [performance receipt](file-vault-performance-2026-09-30.md).

The owner's deleted Vercel Blob objects may be treated as disposable. Working local TextPacks and database state remain active; preserve them and unrelated dirty source. Do not assume old Blob images, downloads, or off-box backups can be recovered.

## Blockers and boundaries

- Private Cloudflare R2 media, backups, and release adapters have focused code tests, but no live buckets, upload/read, scratch restore, Oracle switch, or public release. The owner considers the old Blob files disposable. Off-box backups are unavailable since that store was deleted. Local development can proceed independently.
- Oracle is shared with Algorave. Its PostgreSQL, application, and Caddy services use ports 5434, 3500, and 8445; preserve both the Algorave `use_backend` rule and backend in `/etc/texttext/haproxy.cfg`. Before any infrastructure repair, follow the fleet/database references in `AGENTS.md`, check backups/mtimes/running work, and obtain the separate owner authorization it requires.
- The native 1136 conflict flow once preserved both branches but left Retry/reopen on an offline screen. Fix `a09c0fff` is installed in 1137 but still lacks installed conflict/retry proof. Current production deployment and public sign-in have not been verified. No public push, deployment, release, or billing change was performed by this task.
- Build 1141 intentionally cannot use an unbundled host Codex runtime from its sandbox. The next build needs an explicitly bundled and signed helper before live agent work can be verified. Snapshot-level audit cannot enumerate every contributor if edits coalesce before one upload.
- Preserve unrelated dirty `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, and `scripts/.probe-editor.ts`. Do not reset, clean, or fold them into a task commit.

## References

- [Architecture and implementation](design/texttext-file-vault-migration.md), [implementation receipt](file-vault-implementation-2026-09-30.md), [reference screens and lessons](design/content-first-reference-notes.md), and [DESIGN.md](../DESIGN.md).
- Focused receipts: [starters](file-vault-starters-2026-09-30.md), [capture/import/search](file-vault-capture-import-search-2026-09-30.md), [articles](file-vault-articles-2026-09-30.md), [reader](file-vault-reader-2026-09-30.md), [images](file-vault-images-2026-09-30.md), [previews](file-vault-previews-2026-09-30.md), [customization](file-vault-customization-2026-09-30.md), [folder views](file-vault-folder-views-2026-09-30.md), [recovery](file-vault-recovery-2026-09-30.md), and [collaboration](file-vault-collaboration-2026-09-30.md). Older installed versions in these receipts are historical evidence.
- Older narrative is in [September 30 history](HANDOFF-history-2026-09-30.md). No project changelog entry is due for an unshipped local build.
