# TextText handoff

## Installed and live

- Mac `/Applications/TextText.app`: **0.204 (1207)**, source `2cc028b9`.
  Account/iCloud startup, saved Gallery model metadata, single-photo editor
  save/reopen passed in 1206; 1207 startup, existing note, home navigation and
  saved-body search passed. [Mac receipt](verification/2026-10-08-mac-1207.md).
- Oracle: **texttext-oracle-20261008-2cc028b9-preview**. Thirteen live checks
  passed; actual Safari editor reads the Mac photo metadata.
  [Deployment and live reconnect receipt](verification/2026-10-08-oracle-preview-1207.md).
  Graceful shutdown exited 143 without timeout/SIGKILL. The additive systemd
  override accepts 130/143; ordinary 1207 rollout attested successful exit
  classification. [Service receipt](verification/2026-10-08-oracle-normal-exit.md).
- Windows installed source remains `f3167c4b`.
  Verified candidate **73740adb** passed actual PC native suites, 327 shared-client
  tests, TypeScript, packaging and desktop smoke. Installation awaits closure
  of the old app with unknown unsaved state; save-and-close request is pending.
  [Candidate and paths](verification/2026-10-08-windows-73740adb-candidate.md).
- Current iCloud workspace:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Workspace ID `be28ae03-c64e-4695-80af-04f048f86f37`.
  Preserve existing content; only dedicated verification items were edited.

## Current work and next checks

- Home List/Cards toggles and navigation persistence passed in actual Mac and
  Safari. [Receipt](verification/2026-10-08-home-layouts-live.md).
  Shared source now retains bounded saved-title labels during return navigation,
  and fixes preview invalidation on same-path external edits. Unit and rebuilt
  browser regressions passed. Installed on Mac 1207 and deployed to Oracle.
  Cold first home follow-up now uses placeholders until saved titles arrive,
  retaining readable access/recovery on preview failure. Rebuilt Cards/List and
  light/dark browser checks passed; this follow-up is not installed/deployed.
  [Cold loading receipt](verification/2026-10-08-home-cold-loading.md).
  [Preview receipt](verification/2026-10-08-home-preview-labels.md).
- Install verified Windows candidate when the old process closes, then verify
  startup, existing notes, search, save/reopen, Gallery metadata and live sync.
- Finish automatic reconnect/failure acceptance and canonical sharing with a
  fresh principal and durable acknowledgments. Preserve existing sync gates.
- Agent folder creation is unfinished: shared UI only starts item tasks; Windows
  agent tools are item-scoped. Mac folder tools require an explicit folder task
  flow across clients. Ordinary Mac item tasks no longer expand scope because of
  folder-design metadata; all 15 controller regressions passed (log
  `/tmp/texttext-agent-item-boundary.log`). This fix is not installed yet.
  Local CLI create needs durable idempotency-key handling. Keyed append now
  commits its receipt in the same TextPack replacement; reopen/later-edit retry
  and payload mismatch regression passed. Web package rebuild, Windows core
  rewrite and shared server/agent mutation receipt preservation regressions
  passed. Installed-client round trip remains unverified.
  [Receipt](verification/2026-10-08-local-append-idempotency.md).
  Storage/CLI suites passed 84 tests. Bundled editor smoke now passes with
  current account/cached-permission fixture semantics; the earlier failure was
  stale message and unauthenticated-edit expectations.
  [Offline editor receipt](verification/2026-10-08-offline-editor-smoke.md).
- Complete agent item/template creation acceptance. Real native Gallery image
  description and metadata writing passed; hosted configured-provider generation
  and approval remain unverified.
  [Native acceptance](verification/2026-10-08-gallery-agent-1204.md),
  [web checkpoint fix](verification/2026-10-08-gallery-web-checkpoint.md),
  [image budget](verification/2026-10-08-gallery-photo-input-budget.md).
- Complete service-reference creation/edit/read fidelity and platform performance
  acceptance. [Reference audit](design/template-reference-parity.md) includes
  older findings; inspect current code before treating a finding as missing.
  Automatic bookmark summaries/transcripts/PDF capture remain unfinished.
  Gallery, Feeds, Blog, Notes and command palette need final actual reference
  comparisons. Legacy handle-home parity is not implied by canonical List/Cards.
- Preserve measured search/cache improvements and verify invalidation after
  relevant changes. [Live file roundtrip](verification/2026-10-08-live-file-roundtrip-1202.md).
  Interactive extensions and integrated workspace switching remain unverified.

## External limits

- Commercial ChatGPT account sign-in requires OpenAI registration; owner has
  not received approval/client ID. Google sign-in is not configured on Oracle;
  verify current credential availability before declaring it blocked.
- Second physical Apple-device iCloud delivery, Windows provider eviction and
  hardware power loss are not live-certified.
- Required existing `Shoku's Space/My Notes/TextText Changelog.textpack` was not
  found. Do not create a duplicate.

## Conventions and references

- Follow `AGENTS.md`. Main checkout only; preserve unrelated dirty files.
- Local database for tests. Oracle hosts the app and storage; preserve Algorave.
- One-off local builds/installs and required Oracle product deployments are
  authorized. Public Mac releases require an explicit request.
- Use recorded unaffected test receipts; do not repeat expensive gates without
  a relevant change. [Historical investigations](verification/2026-10-08-handoff-history.md).
