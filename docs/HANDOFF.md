# TextText handoff

## Installed and live

- Mac `/Applications/TextText.app`: **0.204 (1206)**, source `3a115301`.
  Account/iCloud startup, saved Gallery model metadata, single-photo editor
  save/reopen passed. [Mac receipt](verification/2026-10-08-mac-1206.md).
- Oracle: **texttext-oracle-20261008-3a115301-gallery**. Thirteen live checks
  passed; actual Safari editor reads the Mac photo metadata.
  [Deployment receipt](verification/2026-10-08-oracle-gallery-1206.md).
  Graceful shutdown exited 143 without timeout/SIGKILL. The additive systemd
  override now accepts 130/143; next ordinary rollout should attest its exit
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
  browser regressions passed. Not installed/deployed yet.
  [Preview receipt](verification/2026-10-08-home-preview-labels.md).
- Install verified Windows candidate when the old process closes, then verify
  startup, existing notes, search, save/reopen, Gallery metadata and live sync.
- Finish automatic reconnect/failure acceptance and canonical sharing with a
  fresh principal and durable acknowledgments. Preserve existing sync gates.
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
