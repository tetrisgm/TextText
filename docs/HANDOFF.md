# TextText handoff

## Current work

Account sign-in is the current task. The signed-out Mac editor now shows a
sign-in gate, and sign-out flushes the open document before closing that UI.
The web editor routes through `/signin`; a second provider claiming an existing
email must be linked from the existing account in Settings. Focused account
route, adapter, and local PostgreSQL collision tests passed. A Store-shaped
Apple Development build 0.204 (1162) is installed at `/Applications/TextText.app`.
Its native sheet visibly offers “Continue with Touch ID”; the prior Developer ID
build's website consent prompt is gone. The owner completed Touch ID, but the
workspace panel still appeared unchanged: it conflated a saved account with a
separate web sync binding to another server. The follow-up source separates
those states and checks that the Apple credential is actually saved before
reporting success. Build 1162 opens the existing iCloud folder, shows the saved account separately, and offers a confirmation before changing the old localhost sync binding. The full prior journal is archived on this Mac before a fresh cursor is created; the current TextPacks remain in place. The confirmation was inspected and canceled, so the real folder is still bound to localhost. Xcode's const-values pass
currently fails because its CoreDevice components are mismatched. This local
build reused unchanged cached const values and regenerated the required App
Intents metadata (10 intents, 4 shortcuts, 4 parameter summaries). Release
builds still require the normal Xcode pass.
Google exists in source but lacks Oracle OAuth
configuration. OpenAI has not issued a commercial Sign in with ChatGPT client
ID; this identity flow is separate from hosted MCP connector authorization.
No website deployment or public release was approved.

The owner wants one ordinary folder per workspace under a TextText parent folder. TextPacks remain editable directly by people and local agents; connected editors and agents share the same permissioned item identity, live document, audit, and conflict rules. The Mac folder may live in iCloud Drive or another folder provider. Preserve provider conflicts and local recovery data; never infer a remote deletion merely from a temporarily missing cloud file. The owner has not approved a website deployment or public release.

On `main`, these source changes are pushed:

- `d3de105b`: stable permissioned item links survive rename and resolve only through current grants.
- `f6158bc3`, `81a860a5`: verified direct TextPack edits can reconcile into the active Yjs document; unsafe representation changes fence and preserve history.
- `617e3030`: Mac sync, outbox, and shared editing journals are device-local, with copy-only migration of older journals.
- `4c5055c8`: a missing file in an iCloud/CloudStorage root cannot delete its remote counterpart without TextText's durable Trash intent; a restored file cancels the intent.
- `dd34d904`: merged the recovered, attested picker timeout and parsed search-cache source from `8517b9ae`, plus its startup configuration and build fixture changes. The historical branch and receipts are in the [recovered handoff](/Users/shokunin/Documents/Codex/2026-10-04/task-27/TextText-recovered-patches/CODEX_HANDOFF.md).
- `5ea73f3b`: opening an existing folder no longer seeds starter files; Retry save re-reads the pack before clearing a stale file-operation warning.
- `dd78e6fc`: browser regression for a read timeout after a successful save.
- `e50be240`: ChatGPT OAuth for hosted MCP with pinned client metadata,
  consent and PKCE, resource-bound access tokens, rotating refresh grants,
  discovery, and a Connect entry. It has not been deployed or exercised with
  a live ChatGPT connector. Manual tokens remain supported.
- `5cada55d`: explicitly marked local Mac builds report absent release
  attestation as a warning; ordinary release builds and malformed receipts
  still fail. This keeps the retired release gate out of the local install.
- The prior 1157 standalone build added a CLI-only fallback for an unreadable
  app security bookmark when the saved ordinary folder itself is readable.

The installed canonical `/Applications/TextText.app` is local **0.204 (1162)**, an Apple Development signed, sandboxed Store-shaped build with native Apple sign-in, the bundled Codex runtime, and three registered extensions. It opens `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`. The Store edition has no bundled `texttext` CLI, so the signed 1158 standalone CLI is separately installed at `~/.local/share/texttext-cli/0.204-1158/texttext` and linked from `~/.local/bin/texttext`; it listed four iCloud Notes. Its prior broken symlink was preserved as `~/.local/share/texttext-cli/obsolete-link-20261006`. The bundled agent's live connection still needs verification. The prior 1158 app bundle was moved to Trash by the installer. Earlier removed workspaces were compared before deletion; the preinstall Blog recovery copy remains at `/Users/shokunin/Library/Application Support/TextText/Recovery/2026-10-05-preinstall/How we decide what to build.textpack`. No website deployment or public release was made.

The app picker writes a security-scoped bookmark. The earlier standalone CLI could read the saved ordinary folder path when its bookmark was unavailable. Focused `LocalVaultConfigurationTests` and `LocalVaultTests` passed for that change. Build 1162 is locally signed and has no release attestation; the Store sandbox keeps its runtime health report private from the installer. The installer verified the signature, extensions, and single running canonical app. UI verification on 1162 covered the opened workspace, existing note, and distinct account and web sync states; search and save/reopen passed on 1160 and were unaffected by this change. The installed app shows “Signed in to TextText” and separately reports the older folder binding to a different server. Web sync remains unverified. Oracle runs an older release with `/api/vault` present but no `TEXTTEXT_VAULT_ROOT` in `/etc/texttext/runtime.env`; its daily local database backup ran on October 6 and the service is active. The deployed Oracle release already contains the vault route and `TEXTTEXT_VAULT_ROOT` lookup. The next step needs owner coordination under AGENTS.md before creating `/home/ubuntu/texttext/state/vault`, setting that variable in `/etc/texttext/runtime.env`, and restarting only `texttext.service`; no website deployment is needed for this configuration. Do not rebind the folder until the server is ready.

## Verification and next steps

For the new cloud deletion guard, 20 `LocalVaultSyncTests` pass, including provider disappearance, TextText Trash, and file restoration. After merging the recovered source, 55 focused web bridge/server-vault tests, TypeScript, 7 Swift configuration tests, and 4 search-cache tests pass. After `5ea73f3b`, TypeScript, 6 starter-folder tests, and the full local editor browser check pass; the browser check includes save retry, file save, raw agent refresh, and conflict copies. The Swift window integration suite skipped its test because its bundled local web editor was absent at the time; its earlier release gate receipt covers the recovered candidate. The separate 125-second native picker acceptance already passed and should not be repeated without a new reason.

1. Build 1160 opened the existing iCloud folder, listed its Notes, found the existing `Agent file edit verification 1144` note by body text, saved an added build-1160 verification line, reopened the note, and confirmed that line in the TextPack on disk. Its three extensions are signed and registered. Earlier external-edit/search-cache checks and the separate 125-second native picker acceptance passed; repeat them only after relevant changes.
2. iCloud Drive accepted the complete local copy, but off-device upload completion was not independently verified; `brctl status` stalled. The owner explicitly requested permanent removal of the old workspace folders, which are now gone. The active iCloud folder is still present and readable on this Mac.
3. Hosted MCP manual tokens and connected CLI/MCP/in-app agent presence already work. ChatGPT OAuth source passed focused OAuth, MCP, docs, and account-deletion tests; TypeScript, lint, migration order, local PostgreSQL schema/SQL checks, and the Next.js production build passed. A live ChatGPT connector check still needs an approved website deployment. A bare filesystem edit cannot authenticate its process and must be shown as a local file edit. Sign in with ChatGPT inside TextText is a separate inner login flow and may require OpenAI enablement. See [agent interoperability](agent-interoperability.md), [assistant architecture](ai-sidebar-architecture.md), and [official plugin authentication](https://developers.openai.com/plugins/build/auth).
4. Template/reference parity remains discoverable in the [archived handoff](archive/HANDOFF-2026-10-05-pre-file-first.md) and is not verified complete. Do not deploy the website or publish a release without owner approval.

Unrelated dirty files from another worker remain untouched: `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, and `scripts/.probe-editor.ts`.
