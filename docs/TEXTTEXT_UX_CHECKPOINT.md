# TextText content-first checkpoint

## Goal and decisions

Implement the [complete product brief](design/texttext-content-first-ux.md) on ordinary folder workspaces and self-contained editable TextPacks. The [file-vault architecture](design/texttext-file-vault-migration.md) and [handoff](HANDOFF.md) are current references; older checkout and installed-app evidence lives in the linked [receipts](file-vault-implementation-2026-09-30.md). The owner permits local replacement of /Applications/TextText.app. No public push, deployment, app release, billing change or Oracle repair is authorized by this checkpoint. The owner says the deleted Vercel Blob objects may be treated as disposable; local TextPacks and database state remain in use.

## Current state (2026-09-30 evening)

- Branch: main. HEAD at this checkpoint: 54a5dfee. No push or public deployment by this task. Another worker already deleted the Vercel write project and write-media store and pushed prior local commits; do not reset or force push.
- Installed app: 0.202 (1136), /Applications/TextText.app, PID 96997 at 17:47 local; local production-mode Next server PID 98195 at 17:50 local, localhost:3000, output .texttext/vault-tab-journal-build. Recheck process identity before any restart or install. No new persistent jobs.
- The 1136 native file collaboration and direct-agent edit passed against real TextPacks. A conflict recovery retained both branches but left the editor on an offline screen. Retry/reopen fix a09c0fff is committed but not yet installed or live-verified. Retained disposable verification packs: Documents/TextText/Untitled.textpack (identity 2880a21d-7414-438d-a238-0e6cfcba98d9) and Shared file verification 1135 (recovered).textpack; inspect before recoverable cleanup.
- Browser independent-tab recovery is committed and passed 23 focused tests; current build/install acceptance is pending.
- Scoped file/folder sharing backend ef041b40 passed 76 focused checks. Web Share control ebfc2aaa and native bridge 54a5dfee are committed. Native bridge passed seven Swift tests; web transport passed 11 tests and touched ESLint. Invitee discovery/navigation is in progress; no live two-account share acceptance yet.
- Presence commits 1e95bd66, 74c425b1, fbafab84, c5764dae passed 24 focused JS tests, TypeScript, ESLint and six Swift tests. It has bounded 30-second active sessions and grant/epoch checks. Two live signed-in UI sessions and light/dark rendered review remain open.
- Private R2 encrypted-backup code 31394e7a passed 17 focused tests and package import check. No Oracle or Cloudflare settings changed. Off-box backup upload remains broken after the Blob deletion until private bucket credentials, a new upload/read, and an independent scratch restore are verified. Local dumps continue.
- Media R2 code, shared-workspace discovery, and file-vault comment backend are in active agent slices. They are not yet verified or committed at this checkpoint.
- Preserve unrelated dirty attachments.ts, tabs.test.ts and scripts/.probe-editor.ts. Other dirty files belong to the active media/sharing/comment slices; coordinate before editing. The user-owned dependency upgrade a5bc87cb remains in history.

## Next action

1. Wait for the three active slices, inspect exact staged/diff state and focused receipts, and run TypeScript after the media edit settles. The previous TypeScript run during media edits failed in captures and visual-capture; this was reported to its owner.
2. Build the current web bundle once, restart only the task-owned localhost server after verifying its identity, and run real two-account sharing/presence/comment collaboration acceptance and recovery. Keep heavy checks sequential.
3. Build/install the next authorized local Mac app, then verify native Share, actual Retry/reopen, and light/dark/narrow views. Do not call a source compile an installed-app proof.
4. Record current-build performance with mixed library, large visual folder, long note, two collaborators and active agent work; report p95 and process-tree memory misses. Continue remaining RSS, publication, capture/import and visual polish from the brief.
5. Before Oracle infrastructure work, read fleet/Oracle and Algorave procedures, check fresh backups, mtimes and running work. The separate infrastructure approval rule in AGENTS.md applies. Do not touch Algorave services or HAProxy while that boundary is unresolved.

## Evidence and limits

- Native 1136 build/install: /tmp/texttext-build-1136.log and /tmp/texttext-install-1136.log. [Collaboration receipt](file-vault-collaboration-2026-09-30.md).
- Folder, starter, article, image, reader, customization and recovery evidence: [handoff](HANDOFF.md) links focused receipts. Previous installed versions prove only their own revision.
- Built-in preset maintenance uses `scripts/embed-builtin-preset-assets.ts --check` to confirm original cover assets are embedded before a pack ships; see the [starter receipt](file-vault-starters-2026-09-30.md).
- Current native Share tests: /tmp/texttext-native-share-swift-test.log. R2 tests: node --test release/oracle/test-r2-backup-client.mjs release/oracle/test-restore-drill.mjs release/oracle/test.mjs (17 passed). No live R2 acceptance.
- No fresh installed-app, deployed-site, public sign-in or current two-account proof for the latest sharing/presence commits. No current-build performance or memory stability claim.
