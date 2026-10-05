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

The current **local candidate**, 0.204 (1156), is at `/tmp/TextText-Local-Candidate-5cada55d-1156/TextText.app`. It is Developer ID signed, carries the bundled Codex runtime and all three extensions, and passed deep signature and Apple Silicon checks. Main executable SHA-256: `d5c9e26f251e7f03fdd9b177c3126cfc81c33f62aa07cd9a4c970732c4ac5664`; local editor entry SHA-256: `57d2a1fdd96e89ce820f1895b18c75e021b313d4a02b43b65f696dc15159ba31`. In isolated health verification, only the intentionally absent release attestation and its workflow receipts warned; all other checks passed. It has **not** been installed, launched in normal UI, notarized, or release-attested. The earlier 0.204 (1153) release-gate receipts and 0.204 (1154) candidate are documented by `773782f2` and the [recovered handoff](/Users/shokunin/Documents/Codex/2026-10-04/task-27/TextText-recovered-patches/CODEX_HANDOFF.md). The unrelated dirty files listed below remained present during this build.

## Installed-app blocker

The running canonical `/Applications/TextText.app` is version 0.203 (1151), started October 3. Its current window shows `/Users/shokunin/Documents/TextText` and an open Blog editor, `Blog/How we decide what to build.textpack`, with **“The file operation did not finish. Your text is still in the editor.”** and **Retry save**. The accessibility-visible title, body, and headings match the saved pack's `text.md`; this does not prove the editor has no other unsaved state. An exact copy is at `/Users/shokunin/Library/Application Support/TextText/Recovery/2026-10-05-preinstall/How we decide what to build.textpack`; original and copy SHA-256 both `d7c938f06625c0d392ba30ff7660836797c6618ac111435497b88316a26e370f`. Clicking Save and Retry save in the running app did not clear the warning or change the saved pack. Do not quit, replace, or relaunch it until this is resolved.

The newest readable shared `vault.json` (October 4) points to `/tmp/TextText-Native-Picker-Regression-20261005/scratch-vault-20261005-cua`, a 22-pack test vault. The running app displays the 389-pack Documents folder instead. The older sandbox container config was not readable from the shell. Preserve both folders and all configuration. The owner has been asked which folder is the intended real workspace; answer pending.

## Verification and next steps

For the new cloud deletion guard, 20 `LocalVaultSyncTests` pass, including provider disappearance, TextText Trash, and file restoration. After merging the recovered source, 55 focused web bridge/server-vault tests, TypeScript, 7 Swift configuration tests, and 4 search-cache tests pass. After `5ea73f3b`, TypeScript, 6 starter-folder tests, and the full local editor browser check pass; the browser check includes save retry, file save, raw agent refresh, and conflict copies. The Swift window integration suite skipped its test because its bundled local web editor was absent at the time; its earlier release gate receipt covers the recovered candidate. The separate 125-second native picker acceptance already passed and should not be repeated without a new reason.

1. Resolve the running editor's save state without losing its text; confirm the real workspace path. Do not point the app at the test vault by default.
2. Install the verified 1156 local candidate through `mac/scripts/install-local.sh` only after step 1, with `TEXTTEXT_SOURCE_APP` and expected version/build set. Check startup, existing notes, search, save/reopen, and extensions on the installed app. Cache invalidation passed the focused `LocalDocumentSearchTests` after the recovered merge; no later source change touched search.
3. Finish connector identity verification. Hosted MCP manual tokens and connected CLI/MCP/in-app agent presence already work. ChatGPT OAuth source passed focused OAuth, MCP, docs, and account-deletion tests; TypeScript, lint, migration order, local PostgreSQL schema/SQL checks, and the Next.js production build passed. It still needs a live connector check after an approved website deployment. A bare filesystem edit cannot authenticate its process and must be shown as a local file edit. Sign in with ChatGPT inside TextText is a separate inner login flow and may require OpenAI enablement. See [agent interoperability](agent-interoperability.md), [assistant architecture](ai-sidebar-architecture.md), and [official plugin authentication](https://developers.openai.com/plugins/build/auth).
4. Keep template/reference parity work discoverable in the [archived handoff](archive/HANDOFF-2026-10-05-pre-file-first.md). It is not verified complete. Do not deploy the website or publish a release without owner approval.

Unrelated dirty files from another worker remain untouched: `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, and `scripts/.probe-editor.ts`.
