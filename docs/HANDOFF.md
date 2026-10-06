# TextText handoff

## Current work

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
- The installed 1157 build adds a CLI-only fallback for an unreadable app
  security bookmark when the saved ordinary folder itself is readable.

The installed canonical `/Applications/TextText.app` is now local build **0.204 (1157)**, Developer ID signed with the bundled Codex runtime and all three registered extensions. It starts on `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`; the app and its bundled CLI both read that folder. The old `/Users/shokunin/Documents/TextText` workspace and temporary native-picker vault were moved to Trash after a 421-file path/hash comparison and a second comparison of all 21 visible TextPacks. The old app was also moved to Trash by `mac/scripts/install-local.sh`. The preinstall copy of the formerly open Blog pack remains at `/Users/shokunin/Library/Application Support/TextText/Recovery/2026-10-05-preinstall/How we decide what to build.textpack`. No website deployment or public release was made.

The app picker writes a security-scoped bookmark that the unentitled CLI could not resolve. The CLI now falls back to the saved ordinary folder path only when that folder is readable; the app's bookmark remains unchanged. Focused `LocalVaultConfigurationTests` and `LocalVaultTests` pass. The installed 1157 CLI listed the iCloud Notes folder after restart. The local build's runtime health is `warning` only for intentionally absent release attestation/workflow receipts; it is not notarized or release-attested.

## Verification and next steps

For the new cloud deletion guard, 20 `LocalVaultSyncTests` pass, including provider disappearance, TextText Trash, and file restoration. After merging the recovered source, 55 focused web bridge/server-vault tests, TypeScript, 7 Swift configuration tests, and 4 search-cache tests pass. After `5ea73f3b`, TypeScript, 6 starter-folder tests, and the full local editor browser check pass; the browser check includes save retry, file save, raw agent refresh, and conflict copies. The Swift window integration suite skipped its test because its bundled local web editor was absent at the time; its earlier release gate receipt covers the recovered candidate. The separate 125-second native picker acceptance already passed and should not be repeated without a new reason.

1. Local normal-use verification passed: the installed app opened an existing Blog note, searched it, saved and reopened an iCloud Note, reflected an external CLI append in the open note, indexed the new marker, and removed it from search after TextText Trash deletion. Its three extensions are signed and registered. The separate 125-second native picker acceptance already passed and should not be repeated without a new reason.
2. iCloud Drive accepted the complete local copy, but off-device upload completion was not independently verified; `brctl status` stalled. The old workspace copies remain recoverable in Trash until that is confirmed.
3. Hosted MCP manual tokens and connected CLI/MCP/in-app agent presence already work. ChatGPT OAuth source passed focused OAuth, MCP, docs, and account-deletion tests; TypeScript, lint, migration order, local PostgreSQL schema/SQL checks, and the Next.js production build passed. A live ChatGPT connector check still needs an approved website deployment. A bare filesystem edit cannot authenticate its process and must be shown as a local file edit. Sign in with ChatGPT inside TextText is a separate inner login flow and may require OpenAI enablement. See [agent interoperability](agent-interoperability.md), [assistant architecture](ai-sidebar-architecture.md), and [official plugin authentication](https://developers.openai.com/plugins/build/auth).
4. Template/reference parity remains discoverable in the [archived handoff](archive/HANDOFF-2026-10-05-pre-file-first.md) and is not verified complete. Do not deploy the website or publish a release without owner approval.

Unrelated dirty files from another worker remain untouched: `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, and `scripts/.probe-editor.ts`.
