# TextText handoff

## Authoritative delivery

- Mac `/Applications/TextText.app`: **0.204 (1217)**, source `4c84df44`.
  Startup, preserved content, save, search invalidation and reopen passed.
  [Installed receipt](verification/2026-10-08-mac-1217.md).
- Oracle: **texttext-oracle-20261008-0fad4045-parents**, deployed successfully;
  thirteen live checks passed. TextText and all three Algorave services stayed
  active; HAProxy unchanged. [Parent delivery](verification/2026-10-08-notes-parent-menu.md).
- Windows installed source remains `f3167c4b`. Current verified candidate source
  `4c84df44` passed physical PC native suites, 340 shared tests, TypeScript,
  packaging and interactive smoke. [Candidate paths](verification/2026-10-08-reference-picker-delivery.md).
  Process 44968 in the canonical install remains running, rechecked this turn;
  its unsaved state is unknown. Save-and-close request remains unanswered.
- Real workspace: `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`,
  ID `be28ae03-c64e-4695-80af-04f048f86f37`. Preserve content.

## Current candidate / immediate work

- Source `6e1a9ee7`: bounded PDF text capture and plain-template Parent editing.
  Shared capture/enrichment regressions (31 tests), real PDF workers, browser
  note/parent regressions, and TypeScript passed. Standalone traced PDF worker
  executed successfully before the footer-only follow-up. Preparing delivery.
  [PDF receipt](verification/2026-10-08-pdf-capture.md).
- Live Safari created `Notes/Parent menu live verification 1218.textpack` via
  Parent in the insertion menu. Search focused, selected existing stable ID,
  returned focus to writing, and saved. Independent iCloud ZIP inspection
  confirmed exact title/body/parent. Reopen found the older plain Note look hid
  the Parent menu; `381e89d3` fixes this without altering its template.
  `6e1a9ee7` keeps controls inside the card footer; both themes inspected.
- Clean artifact clone: `/private/tmp/texttext-candidate-1195-5ELVuo`.
  Current web build handle `63251`, log `/tmp/texttext-web-pdf-6e1a9ee7-build.log`.
  Revalidate that handle before waiting or restarting. No persistent build job.
- Latest product acceptance for reusable templates: real Mac generation,
  refinement, retained editable blueprint, Save as look, immutable version
  creation/retry, picker reuse and Safari-to-Mac save convergence passed.
  [Authoring receipt](verification/2026-10-08-template-version-authoring.md).
  Current Oracle source contains these changes; installed Windows acceptance remains.

## Remaining acceptance and product work

- Install verified Windows candidate after safe closure, then check account,
  existing notes, search, save/reopen, live sync and actual agent/template creation.
- Finish fresh-principal sharing and automatic reconnect/failure acceptance.
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
