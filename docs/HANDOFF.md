# TextText handoff

## Authoritative delivery

- Mac `/Applications/TextText.app`: **0.204 (1221)**, source `e19d53c3`.
  Signed-in startup, existing content and the reported 1185 note passed without
  recovery controls. Automatic reconnect passed during deployment. Saved-body
  cache invalidation passed on 1221; interactive extensions remain.
  [Current acceptance](verification/2026-10-08-current-client-acceptance.md). Earlier scoped receipt:
  [Installed receipt](verification/2026-10-08-mac-1218.md).
- Oracle: **texttext-oracle-20261008-e19d53c3-capture-reader**, deployed successfully;
  thirteen live checks passed. TextText and all three Algorave services stayed
  previous release retained. Live Safari automatic PDF capture displayed “Dummy PDF file”
  without reload; independent iCloud TextPack inspection confirmed persisted content.
  [PDF delivery](verification/2026-10-08-pdf-capture.md).
- Windows installed source remains `f3167c4b`. Current verified candidate source
  `e19d53c3` passed physical PC native suites, 346 shared tests, TypeScript,
  packaging and interactive smoke. [Candidate paths](verification/2026-10-08-clean-epoch-recovery.md).
  Normal-close request remains pending. PC SSH is reachable again; process 44968
  still runs. Latest candidate path is in the PDF receipt. Do not overwrite a
  running app or discard pending edits.
- Real workspace: `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`,
  ID `be28ae03-c64e-4695-80af-04f048f86f37`. Preserve content.

## Current candidate / immediate work

- Live automatic PDF capture saved correct content but left the open reader
  pending until reload. Current source adds targeted reader invalidation after
  background capture, preserving unsaved drafts. TypeScript and five related
  unit tests and the full browser fixture pass. Oracle deployed and fresh Safari
  acceptance passed. Mac 1221 built, installed and passed signed-in startup,
  existing note and cross-client captured PDF read. Log `/tmp/texttext-mac1221-build.log`.
  Physical Windows candidate verified, not installed.
  [Evidence](verification/2026-10-08-pdf-capture.md).

- Delivered source `6e1a9ee7`: bounded PDF text capture and plain-template Parent editing.
  Shared capture/enrichment regressions (31 tests), real PDF workers, browser
  note/parent regressions, and TypeScript passed. Standalone traced PDF worker
  executed successfully before the footer-only follow-up. Mac installed and Oracle deployed;
  Live PDF capture failed: Turbopack spread the binary worker input and the
  parser received no bytes. `b0f15c7b` fixes the envelope and cleanup, and adds
  a bundled-worker packaging gate. The old compiled worker fails this gate.
  [PDF receipt](verification/2026-10-08-pdf-capture.md).
- Live Safari created `Notes/Parent menu live verification 1218.textpack` via
  Parent in the insertion menu. Search focused, selected existing stable ID,
  returned focus to writing, and saved. Independent iCloud ZIP inspection
  confirmed exact title/body/parent. Reopen found the older plain Note look hid
  the Parent menu; `381e89d3` fixes this without altering its template.
  `6e1a9ee7` keeps controls inside the card footer; both themes inspected.
  Full plain-template Parent menu and focused search now passed actual Mac
  1218 and fresh deployed Safari acceptance.
- Clean artifact clone: `/private/tmp/texttext-candidate-1195-5ELVuo`.
  Web and Mac builds finished successfully. Logs:
  `/tmp/texttext-web-pdf-6e1a9ee7-build.log`, `/tmp/texttext-mac1218-build.log`.
  Final source `8090227e` fixes clean native epoch replacement, including unchanged
  file bytes with replacement Yjs IDs. 346 shared tests and TypeScript passed.
  All builds finished; Mac 1220 installed and Oracle deployed. Logs
  `/tmp/texttext-web-clean-epochs-8090227e-build.log`,
  `/tmp/texttext-windows-8090227e-build.log`, `/tmp/texttext-mac1220-build.log`.
  No persistent build job.
- Latest product acceptance for reusable templates: real Mac generation,
  refinement, retained editable blueprint, Save as look, immutable version
  creation/retry, picker reuse and Safari-to-Mac save convergence passed.
  [Authoring receipt](verification/2026-10-08-template-version-authoring.md).
  Current Oracle source contains these changes; installed Windows acceptance remains.

## Remaining acceptance and product work

- Prioritize Windows false recovery and install current candidate after safe
  closure. The reported 1185 note has zero pending updates but an old retired
  journal. [Root-cause evidence](verification/2026-10-08-clean-epoch-recovery.md).
  Then check account,
  existing notes, search, save/reopen, live sync and actual agent/template creation.
- Two-account local production sharing/collaboration acceptance passed, including
  offline reload, permissions and new-folder discovery.
  [Current receipt](verification/2026-10-08-current-client-acceptance.md).
  Finish physical-client automatic reconnect/failure acceptance.
  Preserve independently tested sync/epoch/outbox/receipt behavior and direct
  file editing. Second physical Apple-device iCloud delivery, Windows provider
  eviction and hardware power loss are not live-certified.
- Complete the six service-reference creation/edit/read comparisons and fix
  concrete gaps. [Requirement map](design/template-reference-parity.md).
  PDF embedded text is now implemented; original PDF attachments, OCR,
  transcripts and automatic per-bookmark AI summaries remain separate work.
  Gallery opt-in native image description already passed; hosted configured
  provider generation/approval remains unverified.
- Verify integrated platform performance, interactive extensions and workspace
  switching. Retain measured search/cache improvements and only remeasure
  affected paths. [Bounded performance](verification/2026-10-07-file-vault-bounded-performance.md),
  [live file roundtrip](verification/2026-10-08-live-file-roundtrip-1202.md).
- Existing 22-check receipts certify their exact sources, not all later changes:
  [0428bfca receipt](verification/2026-10-08-windows-creation-release-gates.json).
  Later source uses relevant tests and delivery checks; do not claim unsupported completion.

## External limits

- OpenAI commercial account sign-in is deferred by the owner and does not block
  this version. Existing authorized agent/runtime integration remains in scope.
- Google sign-in is unconfigured on Oracle. Signed-in console inspection found
  an existing Texttext client with the correct callback and masked enabled
  secret, but neither runtime variable nor the expected Keychain entry exists.
  Replacement-secret approval is pending. Audit:
  `/tmp/texttext-google-configuration-audit.md`. No new secret/account was created.
- Hosted provider/model acceptance needs an authorized configured provider;
  Mac development keys have not been copied to Oracle.
- Required `Shoku's Space/My Notes/TextText Changelog.textpack` was not found;
  do not create a duplicate or repository changelog.
- Oracle-only storage/backups are the owner's decision. No R2/Vercel, public Mac
  release, automated build/install job or unrelated service change.

## Prior evidence

[Archived handoff](verification/2026-10-08-handoff-before-current-audit.md)
retains earlier receipts and investigations, including resolved findings whose
old “source only” wording is superseded by current delivery. Prefer current
source and receipts above over those historical status statements.
