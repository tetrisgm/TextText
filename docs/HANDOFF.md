# TextText handoff

## Current state

- `/Applications/TextText.app` is local Store-shaped **0.204 (1173)**, signed with
  all three extensions. It opens the existing iCloud Drive workspace at
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  User files and journals were preserved. No public Mac release was published.
  The local development install bypassed sandbox-private runtime attestation;
  installed startup, editing, reopening and search were verified in the app.
- Oracle serves `texttext-oracle-20261007T092817Z-f151886c`. The deployment
  passed authenticated browser-cookie origin enforcement, native read/write,
  storage and audit smoke checks. Previous release retained; Algorave active
  and HAProxy unchanged. Vault storage is `/home/ubuntu/texttext/state/vault`.
- Native window/session invalidation, in-flight credential renewal, retryable
  server errors and upload backoff are fixed. Browser cookie writes now use the
  validated public origin behind Oracle's proxy. Server Markdown checkpoints
  preserve the actual relative file path, including after rename.
- See the [sync failure audit and verification](verification/2026-10-07-sync-failure-audit.md)
  for reproductions, test counts and remaining limits. `npm run test:sync` is a
  committed manual regression suite and runs in the normal release workflow.
  No background build, install or release job was added.

## Live verification

- Mac edits reached Safari. Direct edits of `text.md` inside a TextPack, without
  rewriting `document.json`, reached Mac, Safari and search. Safari edits then
  reached the Mac's file. Marker removal invalidated search correctly.
- Original note text remains. Temporary markers were removed; the test-only
  recovered copy was moved to recoverable Trash. Both clients reopened the
  original without recovery banners. Both workspace inventories have 21 active
  TextPacks. After the final browser save, the edited note’s Markdown and all
  three JSON entries match exactly on Mac and Oracle. Its archive bytes differ
  between native/server encoding; the other 20 archive hashes match. The final
  path metadata fix has a rename regression as well.
- The previous 125-second picker receipt remains applicable; no picker changes.
  See [earlier handoff](archive/HANDOFF-2026-10-06-before-oracle-workspace.md).

## Follow-up and boundaries

- Actual iCloud transfer/eviction on a second physical Apple device remains
  unverified. Native provider-absence and real HTTP two-folder tests passed;
  they do not certify Apple's cross-device transport or power-loss behavior.
- The existing `Shoku's Space/My Notes/TextText Changelog.textpack` is absent from
  the active workspace (`texttext search 'TextText Changelog' --json`: no match).
  No duplicate changelog was created.
- The separately installed CLI at `~/.local/bin/texttext` still uses standalone
  build 1158. The bundled agent's live connection and template/reference parity
  are outside this sync verification.
- Unrelated worker changes remain untouched in
  `src/components/workspace/assistant/attachments.ts`,
  `src/lib/workspace/__tests__/tabs.test.ts` and `scripts/.probe-editor.ts`.
- Oracle web deployment is authorized by the owner. Public Mac releases still
  require an explicit request. Preserve Algorave and HAProxy routing.
