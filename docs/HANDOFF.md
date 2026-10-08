# TextText handoff

## Installed and live

- Mac `/Applications/TextText.app`: **0.204 (1186)**, source `a6fee0e4`.
- Windows: same source `a6fee0e4`, installed in the existing location.
- Oracle: **texttext-oracle-20261008T065451Z-a6fee0e4**, thirteen live checks passed.
- Accounts, existing notes, saved edits and search freshness passed on installed
  clients. Agent-created template item arrived on both desktops automatically;
  Safari opened the same item with Mac/Windows presence.
  [Current receipt](verification/2026-10-08-shared-template-preview-1186.md),
  [Windows receipt](verification/2026-10-07-windows-shared-1186.md).
- Mac folder:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Only dedicated verification notes changed during acceptance.

## Current work

- Source `a6fee0e4` passed 546 core tests, TypeScript, native gates and relevant
  browser checks. Agent template creation and durable template/folder approvals
  now use canonical file operations and retry receipts.
- Shared reader optimizations reduced the bounded 525 KiB note open from
  1.5–1.6 seconds to 170 ms; cached reopen measured 254 ms. Unchanged
  status/presence no longer reparses Markdown. Actual edits still invalidate.
  [Performance evidence](verification/2026-10-07-file-vault-bounded-performance.md).
- Shared frozen-content previews for saved template proposals and saved-title
  labels are installed. Web Customize and guarded application previews are next.
- Follow-ups awaiting the next verified build: immediate automatic reconnect
  probe (`fd0355f0`), bookmark baseline release (`99baf311`), and fresh shared
  discovery permission checks (`4034f736`). Focused regressions passed.
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
- Account workspace discovery remains incomplete. Windows live folder-picker
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
