# TextText handoff

## Installed and live

- Mac `/Applications/TextText.app`: **0.204 (1189)**, source `54f33a4e`.
- Windows: same source `54f33a4e`, installed in the existing location.
- Oracle: **texttext-oracle-20261008T073956Z-43614e64**, thirteen live checks passed.
- Live 1188 acceptance found a permission-only listing notification gap in both
  native adapters. Build 1189 fixes it with controller/engine regressions.
  Mac save/search/reopen and automatic Mac-to-Windows/web and Windows-to-Mac/web
  marker delivery passed; local TextPack contains both markers exactly once.
  [Current receipt](verification/2026-10-08-workspace-capabilities-1189.md).
- Accounts, existing notes, saved edits and search freshness passed on installed
  clients. Agent-created template item arrived on both desktops automatically;
  Safari opened the same item with Mac/Windows presence.
  [Current receipt](verification/2026-10-08-reconnect-customize-1187.md),
  [Windows receipt](verification/2026-10-08-windows-shared-1187.md).
- Mac folder:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Only dedicated verification notes changed during acceptance.

## Current work

- Next agent slice: canonical `remix_item_type`, copying validated definitions
  into a new template identity with source/hash authorization and durable retry.
  Implementation in progress; not shipped. Folder defaults require shared UI
  and canonical creation to honor them, beyond writing a folder-view file.

- Source `4c7efe85` passed 555 core tests, TypeScript, native gates and relevant
  browser checks. Agent template creation and durable template/folder approvals
  now use canonical file operations and retry receipts.
- Shared reader optimizations reduced the bounded 525 KiB note open from
  1.5–1.6 seconds to 170 ms; cached reopen measured 254 ms. Unchanged
  status/presence no longer reparses Markdown. Actual edits still invalidate.
  [Performance evidence](verification/2026-10-07-file-vault-bounded-performance.md).
- Shared frozen-content template previews, web item Customize and guarded
  application approvals are installed. Folder customization remains native-only.
- Immediate automatic reconnect probes, bookmark baseline release and fresh
  shared discovery permission checks are installed.
- Source-only workspace switching now includes account discovery, fresh membership
  authorization, commit-time editor flush, and shared permission-aware UI.
  Windows changes through `fa49b978` pass 160 Core assertions and crosscompile;
  shared UI `a5dc4d6a` passes focused unit/browser checks and TypeScript.
  Mac `43614e64` includes persisted offline capability handling. The integrated
  gate passed 588 core tests and required native suites; Windows passed 269
  shared-client tests and actual desktop smoke. Owner-capability HTTP fixture
  `d17b0052` passed the real native two-vault contract check. Native and Safari
  account menus list the current workspace; live cross-workspace switching is
  not attested because this account has one workspace.
- Core gate now also includes bookmark retention regressions (`0cbe0914`).
- Owner-approved obsolete deployment cleanup restored Oracle free space;
  retained current/rollback/candidate, all content and backups. No cleanup job.
- Automatic request/bootstrap recovery and graceful read-poll shutdown are
  installed. [Recovery receipt](verification/2026-10-07-recovery-templates-1184.md),
  [shutdown evidence](verification/2026-10-07-read-poll-shutdown.md).
- Standalone CLI `ccf675f8` remains installed; real account commands and template
  create/update/retry work while local reads stay offline.
  [CLI receipt](verification/2026-10-07-cli-account-commands.md).
- No web provider is configured; live model execution is not attested.

Keep one canonical file system and shared UI/editor/sync implementation across
Mac, Windows and web. Native adapters handle filesystem, credentials and OS
integration. Legacy data migration is explicitly out of scope; no deletion is
needed to stop using legacy content paths. Home List/Cards already shares items
and actions, with a personal per-device/workspace preference.

## Remaining scope and external limits

- [Agent command inventory](agent-file-backend.md).
- [Reference-template parity audit](design/template-reference-parity.md).
- Google client exists but its secret is unavailable; Oracle Google sign-in is
  not configured. Commercial ChatGPT sign-in requires OpenAI registration that
  the owner does not yet have.
- Integrated workspace switching acceptance remains incomplete. Windows live folder-picker
  acceptance is deferred; isolated native checks passed.
- Second physical Apple-device iCloud delivery, Windows provider eviction and
  hardware power loss are not live-certified.
- Required existing `Shoku's Space/My Notes/TextText Changelog.textpack` was not
  found. Do not create a duplicate. Standalone CLI receipt:
  [current CLI](verification/2026-10-07-standalone-cli-current.md).

## Working conventions and evidence

- [Sync subsystem contract](../sync/README.md) and exact-source gates cover
  journals, external edits, epochs, recovery, acknowledgements and sessions.
  Reuse unaffected receipts; verify relevant changes.
- Preserve unrelated edits in `src/components/workspace/assistant/attachments.ts`,
  `src/lib/workspace/__tests__/tabs.test.ts`, `scripts/.probe-editor.ts` and the
  existing Python cache. Coordinate concurrent edits before staging.
- Local client installs and needed Oracle deployments are authorized. Public
  desktop releases require an explicit request. No automated build/install jobs.
- [Archived implementation history](verification/2026-10-07-handoff-before-shared-templates.md).
