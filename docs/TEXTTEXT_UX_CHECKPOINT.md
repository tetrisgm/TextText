# TextText content-first checkpoint

## Goal and decisions

Complete the [product brief](design/texttext-content-first-ux.md) on ordinary folder workspaces and self-contained TextPacks. The [file-vault architecture](design/texttext-file-vault-migration.md) governs storage and sync. The owner authorizes replacing the local `/Applications/TextText.app` with the work-in-progress build. The deleted Vercel Blob objects are disposable; preserve working local TextPacks, database state, and unrelated dirty code. No public deployment, release, or Oracle repair is part of the current local verification.

## Current state (2026-09-30, local evening)

- Branch `main`, HEAD `022e9976` when this checkpoint was written, ahead of origin. This task has not pushed or deployed. Before editing, `git status` showed unrelated modified `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, untracked `scripts/.probe-editor.ts`, plus RSS worker edits in `src/local-vault/bridge.ts` and `src/local-vault/web-transport.ts`. Preserve the unrelated files and coordinate with the RSS worker.
- Local production-mode Next server listens on `localhost:3000`, PID 2015 observed at this checkpoint, build identity `texttext-vault-publish-fix-20260930`, output `.texttext/vault-publish-fix-build`, log `/tmp/texttext-vault-publish-fix-server.log`. Recheck PID, command, cwd, and build identity before stopping it. No new persistent job was installed.
- `/Applications/TextText.app` remains native 0.202 build 1136, Apple Development signed, bound to `http://localhost:3000`. Its newer native retry, Share, comments, presence, and Publish bridge code has not been installed or verified in the app yet. Previous build/install logs: `/tmp/texttext-build-1136.log`, `/tmp/texttext-install-1136.log`.
- One RSS UI worker is adding feed discovery/subscriptions, explicit Keep, and Command-K filename/path search on top of committed RSS backend `afb1c694` and bounded preview/fetch fix `dac5ad2c`. One performance worker is preparing a bounded current-vault benchmark; its heavy run is held until the final integrated server build. No other code workers are active.

## Verified work

- Folder store, complete TextPack sync, starters, capture/import, reader annotations, image galleries, templates/folder presentations, agent-backed customization, and recovery have earlier focused receipts linked from [handoff](HANDOFF.md). Those installed proofs belong to older builds and do not establish current-build quality.
- Local file collaboration, browser/native transport, independent offline journals, scoped grants, active presence, comments, public saved-copy presentation and explicit Publish are committed through `022e9976`. Publishing checks server-acknowledged full-document state before exposing a file; public rendering excludes private comments and unused custom template metadata. Source tests and production builds passed for the individual slices.
- `scripts/verify-file-collaboration.ts` passed two signed-in accounts: live participant display, comment/reply without reload, exact canonical TextPack comment bytes, concurrent edits, scoped undo/redo, offline/reload/three-editor convergence, idle no-repeat uploads, and permission downgrade. Log: `/tmp/texttext-file-collaboration-integrated.log`. A layout defect found on the first run was fixed in `820f81f8` before this pass.
- `scripts/verify-file-sharing.ts` passed on the current publish-fix build: private access denial; commenter grant, discovery, and open; edit/resolve/publish denial; allowed comment; anonymous 404 before publish; owner UI publish with saved body and no private comments; immediate anonymous 404 after unpublish; revocation removes access and listing. Zero browser runtime errors. Log: `/tmp/texttext-file-sharing-publish-fix.log`. The first run caught a metadata-only revision mismatch; `022e9976` fixed it and the rerun passed.
- Private Cloudflare R2 media, backup, and release adapters are code-only (`3026fcf2`, `31394e7a`, `632c923d` and follow-ups). Focused tests passed. No bucket, live upload/read, scratch restore, Oracle switch, public release, or appcast verification has occurred. Deleted Blob media and off-box backups were not migrated.

## Exact next work

1. Let the RSS UI worker finish and commit its exact files; inspect its diff and focused tests. Build one integrated production web bundle and restart only the verified task-owned localhost server. Run the RSS browser journey and check Command-K, including a feed whose entries are not saved until Keep.
2. Build native 0.202 build 1137 or higher with the existing local Apple Development signing/profile setup and `http://localhost:3000` origin; use the authorized local installer to replace the canonical app. Verify the installed native app opens and exercises Share, Publish, RSS, comments, and retry/reopen. Use two Swift jobs and sequential heavy checks. Do not call a source compile installed-app proof.
3. Give the performance worker the final server build go-ahead. It will use one Chromium instance, a UUID disposable workspace, a bounded mixed library, and a 15-minute / 2-GiB-per-process-tree abort limit. Record actual p95 and memory misses; fix measured hot-path defects.
4. Inspect actual rendered note, gallery, reader, Add agent, and active shared edit in light/dark and normal/narrow sizes. Verify remaining brief journeys on the current native build, especially folder additions and real agent run during concurrent human edits. Keep the checkpoint current before expensive work or a long session break.

## Limits and references

- The local server uses existing development accounts. Current public sign-in, deployment, and the deleted Blob data are unverified or unavailable.
- The native 1136 conflict flow once preserved both branches but left Retry/reopen on an offline screen. Fix `a09c0fff` is committed and awaits installed proof. Retained disposable verification packs are identified in [collaboration receipt](file-vault-collaboration-2026-09-30.md); inspect before recoverable cleanup.
- The full [handoff](HANDOFF.md) links the slice receipts. Historical process IDs and installed versions in older receipts are not live state. Before Oracle work, follow the fleet and database references in `AGENTS.md`, inspect recent backups and concurrent edits, and preserve Algorave ports/HAProxy rules. The infrastructure authorization boundary still applies.
