# TextText handoff

## Installed and live

- Mac `/Applications/TextText.app`: **0.204 (1211)**, source `626f965c`.
  Actual folder agent inherited its custom default; ZIP identity/content,
  editor save, saved-body search and reopen passed.
  [1211 receipt](verification/2026-10-08-mac-1211.md).
  Assistant retained authorization required clicking Connect Codex to discover
  it; automatic startup discovery remains a follow-up.
  Actual Save as look now passes on a receipt-bearing note: exact content,
  fresh identity, no inherited receipts, original receipt retained.
  [1210 receipt](verification/2026-10-08-mac-1210.md).
  Signed native Apple sign-in build; account/iCloud startup, existing note,
  saved-body search, editor save and ZIP persistence passed.
  [1209 receipt](verification/2026-10-08-mac-1209.md).
  Real native folder agent creation, persisted TextPack reopen and saved-body
  search passed. [1208 receipt](verification/2026-10-08-mac-1208.md).
  Account/iCloud startup, saved Gallery model metadata, single-photo editor
  save/reopen passed in 1206; 1207 startup, existing note, home navigation and
  saved-body search passed. [Mac receipt](verification/2026-10-08-mac-1207.md).
- Oracle: **texttext-oracle-20261008-e4ae9937-copy**. Thirteen live checks
  passed; [current receipt](verification/2026-10-08-oracle-copy-receipts.md).
  Shared identity-copy receipt isolation and web loading/provider labels deployed.
  Actual Safari copy acceptance remains.
  Prior preview verification: actual Safari editor reads the Mac photo metadata.
  [Deployment and live reconnect receipt](verification/2026-10-08-oracle-preview-1207.md).
  Graceful shutdown exited 143 without timeout/SIGKILL. The additive systemd
  override accepts 130/143; ordinary 1207 rollout attested successful exit
  classification. [Service receipt](verification/2026-10-08-oracle-normal-exit.md).
- Windows installed source remains `f3167c4b`.
  Verified candidate **d7455797** passed actual PC native suites, 330 shared-client
  tests, TypeScript, packaging and desktop smoke. Installation awaits closure
  of the old app with unknown unsaved state; save-and-close request is pending.
  [Candidate and paths](verification/2026-10-08-windows-d7455797-candidate.md).
- Current iCloud workspace:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Workspace ID `be28ae03-c64e-4695-80af-04f048f86f37`.
  Preserve existing content; only dedicated verification items were edited.

## Current work and next checks

- Mac agentStatus now checks retained runtime authorization once on first use.
  Signed-out discovery never starts browser login or repeated runtimes; explicit
  disconnect is not undone by status reads. Explicit Connect still starts login.
  All 18 controller regressions passed. Source only, not installed; installed
  1211 remains the observed old behavior. Log `/tmp/texttext-agent-account-restore.log`.

- Shared transport now accepts explicit Article/Gallery/Talk creation, matching
  the Windows agent advertised types. Package regressions prove content and
  template identity; unsupported types still refuse. Folder-default loading
  carries cancellation and stopped tasks do not publish. All 332 shared-client
  tests across 38 files and TypeScript passed. Source only, not delivered.
  Logs `/tmp/texttext-template-inheritance-{client,types}.log`.

- Windows folder-agent creation now resolves the same validated folder default
  as human creation when kind is omitted, publishing one complete TextPack.
  Explicit built-in kind keeps its override. Regression proves template/content
  persistence and malformed-default refusal before creation; 12 targeted tests
  and TypeScript passed. Source only; candidate d7455797 predates this fix.
  Logs `/tmp/texttext-windows-agent-folder-default{,-types}.log`.

- Native agent creation no longer forces built-in Note when kind is omitted.
  It inherits the selected folder default through the ordinary DocumentStore
  creation path. Regression proves inheritance, explicit Note override and
  unchanged design-file hash; 14 agent file tests passed. Source only, not
  installed. Log `/tmp/texttext-agent-default-template.log`.

- Agent blueprint instructions now allow plain notes/articles without invented
  fields, using existing title/body/assets and a minimal Medium-like Blog example.
  Tool/generation/blueprint suites: 62 tests passed; TypeScript passed.
  Source only; native reusable-library tools and hosted library grant remain.
  Logs `/tmp/texttext-template-minimal-fields{,-types}.log`.

- Mac 1209 runtime Save as look failed before destination creation. Fixed stale
  ZIP offset use when receipt removal precedes Markdown extraction. Regression
  now places Markdown after receipts; 53 storage/remote tests passed. Mac 1210
  installed and actual clone acceptance passed.
  [Runtime finding](verification/2026-10-08-mac-1209.md).

- Mac 1208 reusable agent design → Save as look → New from template → saved
  item passed. Package inspection found copied identity-specific mutation
  receipts. Native clone fix and 53 storage/remote tests passed, not installed.
  Web/Windows share the package encoder, now stripping receipts on new identity
  and retaining them on ordinary writes. All 330 shared-client tests and
  TypeScript passed; native import regression passed. Rebuild/install/deploy
  these changes on Windows/Oracle; Mac 1209 is installed with startup/search/save
  acceptance. Fresh runtime clone acceptance remains. Existing copies remain untouched.
  [Acceptance and fix receipt](verification/2026-10-08-reusable-template-1208.md).

- Oracle candidate `af65cbc6` deployed successfully after matching core/native
  sync gates (828 core tests, all native regressions). All 13 live checks passed.
  [Deployment receipt](verification/2026-10-08-oracle-folder-agent.md).
  Actual Safari folder target/approval copy passed. Its production workspace
  provider is disconnected, preventing live model/proposal acceptance. Existing
  development Keychain keys were only checked for presence, not moved to Oracle.
  Web loading/provider-label fixes passed TypeScript, not yet deployed.
- Local CLI keyed creation/capture now uses a durable prepared-package journal.
  Rename/edit retries, deletion/duplicate fences, capture retry, prepared-intent
  resumption and concurrent local creation passed in 64 native tests.
  [Receipt and explicit limits](verification/2026-10-08-local-creation-journal.md).
  CLI source `ffbc83ee` is installed. Fresh-process iCloud-workspace creation,
  rename, later CLI edit, retry with unchanged package hash, and mismatched
  payload rejection passed. Mac app remains 1208; cross-device iCloud keyed
  creation is not attested by the local lock tests.
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
- Windows candidate matching Mac 1208 completed all gates and packaging.
  [Receipt](verification/2026-10-08-windows-9a38e556-candidate.md).
  Fresh query still found the old app PID 44968 responding with no window title;
  unknown unsaved state prevents replacement until safely closed.
- Install verified Windows candidate when the old process closes, then verify
  startup, existing notes, search, save/reopen, Gallery metadata and live sync.
- Finish automatic reconnect/failure acceptance and canonical sharing with a
  fresh principal and durable acknowledgments. Preserve existing sync gates.
- Agent folder creation is unfinished: desktop source now exposes Add agent
  from the current folder menu, passing explicit folder scope without an item
  path. Actual bundled browser dispatch and existing web customization checks
  passed; TypeScript passed. Logs `/tmp/texttext-folder-agent-browser-fixed.log`
  and `/tmp/texttext-folder-customize-regression.log`. Dark preview inspected. Folder navigation regression now proves isolated
  drafts, original-folder fencing during an active turn, post-turn retargeting
  and empty-root dispatch (`/tmp/texttext-folder-agent-navigation.log`);
  TypeScript passed (`/tmp/texttext-folder-navigation-types.log`).
  Installed Mac 1208 passed real folder note creation and reopen/search;
  Windows live model creation and hosted folder authorization remain unverified. Mac bridge now accepts validated `folderPath`, rejects
  mixed item/folder/photo/customization requests, and exposes creation tools
  within that boundary. All 16 controller tests passed; log
  `/tmp/texttext-explicit-agent-folder.log`. UI/Windows wiring is pending.
  Shared draft storage now separates item/folder scope, preserves root-folder
  drafts and fences late updates by scope; 7 regressions and TypeScript passed
  (`/tmp/texttext-agent-task-scope.log`, `/tmp/texttext-agent-task-scope-types.log`).
  Assistant panel now accepts a folder target and preserves its scope through
  draft recovery, updates, send and cancellation; it sends `folderPath` instead
  of an item path. Eight scope regressions and TypeScript passed
  (`/tmp/texttext-folder-panel-scope.log`, `/tmp/texttext-folder-panel-types.log`).
  Hosted folder authorization and full model acceptance remain pending.
  Desktop folder action wiring is in source; hosted action is not exposed.
  Windows shared folder tool adapter now implements list/create/read/write with
  existing-folder and path-boundary validation; four adapter regressions and
  TypeScript passed (`/tmp/texttext-windows-folder-tools.log`,
  `/tmp/texttext-windows-folder-tools-types.log`). Native dispatcher/event
  wiring now carries an explicit folder flag through native preflight, tool
  dispatch and WebView relay. App-server tests passed folder creation/denial plus
  existing item/cancel/login/process checks on the Mac .NET runtime; log
  `/tmp/texttext-windows-folder-dispatch.log`. TypeScript passed. Actual PC build and native regressions passed in candidate 0566c006.
  UI acceptance remains pending; no installed folder support is claimed.
  Windows folder search now uses ordinary cached search with a folder filter
  and defensive result boundary, query/output limits and cancellation. Five
  adapter tests, native folder-search dispatch and existing agent regressions,
  and TypeScript passed (`/tmp/texttext-windows-folder-search.log`,
  `/tmp/texttext-windows-folder-search-native.log`,
  `/tmp/texttext-windows-folder-search-types.log`). Not in the PC candidate yet.
  Hosted folder boundary is implemented at the canonical file adapter and
  durable proposal stage/approval, with 56 tests and TypeScript passing.
  [Receipt and remaining wiring](verification/2026-10-08-hosted-folder-boundary.md).
  `/api/ai`, web transport and shared folder menu now issue the selected-folder
  grant. Transport/catalog/adapter tests passed (29), TypeScript and rebuilt
  desktop folder-agent browser regression passed. Live hosted task/approval and
  Oracle rollout remain; template-library commands require cross-library rules.
  Rebuilt web-shaped folder UI now verifies root-folder proposal controls and
  approval receipt. Fixed the item-only condition that previously hid those
  controls; desktop regression and TypeScript also passed.
  Ordinary Mac item tasks no longer expand scope because of
  folder-design metadata; all 15 controller regressions passed (log
  `/tmp/texttext-agent-item-boundary.log`). This fix is not installed yet.
  Durable local create/capture is now installed and verified as recorded above.
  Keyed append commits its receipt in the same TextPack replacement; reopen/later-edit retry
  and payload mismatch regression passed. Web package rebuild, Windows core
  rewrite and shared server/agent mutation receipt preservation regressions
  passed. Installed Mac 1208/updated CLI round trip passed: keyed append, later app
  edit, fresh-process retry with unchanged hash/identity and one append, and
  changed-payload rejection without a write. Windows/web delivery remains
  unverified. Previous CLI binary retained; no persistent job installed.
  [Receipt](verification/2026-10-08-local-append-idempotency.md).
  Storage/CLI suites passed 84 tests. Bundled editor smoke now passes with
  current account/cached-permission fixture semantics; the earlier failure was
  stale message and unauthenticated-edit expectations.
  [Offline editor receipt](verification/2026-10-08-offline-editor-smoke.md).
- Native Mac 1208 item design generation/preview/keep passed with exact content
  and asset preservation and retained mutation receipt. Reader settled after a
  brief automatic sync wait. [Receipt](verification/2026-10-08-native-design-1208.md).
  New customization requests now clear stale prior-task conversation in source;
  browser regression and TypeScript passed, not installed.
- Complete reusable agent template-library creation acceptance. Real native Gallery image
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
