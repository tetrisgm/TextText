# TextText handoff

## Installed and live

- Current Windows source `36c91bd2` passed actual PC packaging and desktop smoke,
  including the new native write-receipt regressions. Not installed; the older
  app remains running with unknown unsaved state.
  [Candidate receipt](verification/2026-10-08-windows-36c91bd2-candidate.md).

- Mac `/Applications/TextText.app`: **0.204 (1214)**, source `3382b36a`.
  Actual startup/account/iCloud, existing custom-template note, editor save,
  on-disk marker, saved-body search and reopen passed.
  [1214 receipt](verification/2026-10-08-mac-1214.md).
  Actual atomic Save as look and library discovery passed; original fixture
  hash/content unchanged, new matching identity and opaque entries retained.
  [1213 receipt](verification/2026-10-08-mac-1213.md).
  Actual folder agent inherited its custom default; ZIP identity/content,
  editor save, saved-body search and reopen passed.
  [1211 receipt](verification/2026-10-08-mac-1211.md).
  Automatic retained agent authorization discovery now passed without Connect
  or browser login. Actual Safari save to local file and CLI return to the
  open Safari editor passed; Mac reopen retained both markers and custom look.
  [1212 receipt](verification/2026-10-08-mac-1212.md).
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
- Oracle: **texttext-oracle-20261008-cce4206c-atomic**. Thirteen live checks
  passed; [current receipt](verification/2026-10-08-oracle-atomic-look.md).
  Shared identity-copy receipt isolation and web loading/provider labels deployed.
  Actual Safari atomic Save as look and local iCloud delivery passed; source
  hash/content unchanged and new matching template identity verified.
  Prior preview verification: actual Safari editor reads the Mac photo metadata.
  [Deployment and live reconnect receipt](verification/2026-10-08-oracle-preview-1207.md).
  Graceful shutdown exited 143 without timeout/SIGKILL. The additive systemd
  override accepts 130/143; ordinary 1207 rollout attested successful exit
  classification. [Service receipt](verification/2026-10-08-oracle-normal-exit.md).
- Windows installed source remains `f3167c4b`.
  Verified candidate **cce4206c** passed actual PC native suites, 334 shared-client
  tests, TypeScript, packaging and desktop smoke. Installation awaits closure
  of the old app with unknown unsaved state; save-and-close request is pending.
  [Candidate and paths](verification/2026-10-08-windows-cce4206c-candidate.md).
- Current iCloud workspace:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Workspace ID `be28ae03-c64e-4695-80af-04f048f86f37`.
  Preserve existing content; only dedicated verification items were edited.

## Current work and next checks

- Windows native file writes now persist operation intent/completion receipts;
  repeated writes follow committed identity after rename/edit and refuse
  resurrection after deletion. Interrupted completion accepts only exact
  prepared bytes; future/tampered intents fail closed. Creation publication
  uses a no-overwrite move. Native bridge receives the shared operation ID;
  shared transport honors the returned current path. Portable native suites,
  47 shared transport tests and TypeScript pass. Logs:
  `/tmp/texttext-windows-native-mutation-receipts.log`,
  `/tmp/texttext-native-retry-follow-path.log`,
  `/tmp/texttext-windows-mutation-types.log`. Source only: physical Windows
  build/install and higher-level repeated agent creation remain unverified.

- Replaced the legacy SQL sharing evaluator with real file-backed acceptance.
  Creation retries, stale-write refusal, persisted comments, two-principal
  viewer/editor permission changes, immediate revocation, approved cover import,
  Trash/restore retry and attributed audits passed in an isolated local workspace.
  Logs: `/tmp/texttext-file-workflow-live.log`,
  `/tmp/texttext-file-workflow-types.log`. Bookmark recapture and Living brief
  remain explicitly unverified; this evaluator does not certify those features.
  Rerun the required full release gate on the committed candidate before delivery.

- Candidate `0d452874` is running the required full release gate (`48138`), log
  `/tmp/texttext-reader-fixed-release-gates.log`. The preceding gate failed only
  when the reader rerender fixture omitted its TextPack identity. That fixture
  now uses the real serializer; its focused check passed with one parse before
  and after repeated status and presence updates. No delivery is implied.
  The candidate directory below now contains `0d452874`; its earlier packaged
  archive remains older source and must not be deployed as this candidate.

- Oracle template delivery candidate is clean source `223954b8` in
  `/private/tmp/texttext-candidate-1195-5ELVuo`. Exact core gates passed
  (837 tests, 87 files), native sync gates passed, and the production web
  build and immutable packaging completed successfully. Logs:
  `/tmp/texttext-oracle-template-gates.log`,
  `/tmp/texttext-template-native-gates.log`,
  `/tmp/texttext-oracle-template-build.log`, `/tmp/texttext-template-package.log`.
  Full required release checks first stopped at stale generated MCP docs
  (`99704` terminal), then historical handoff links and temporary fixture
  paths (`98957` terminal). Both failures are corrected in `3e01429e` and
  `b403c984`; docs verification and all seven sync-verifier regressions pass.
  The clean clone is `b403c984`; full release verification stopped at the
  stale MCP live-client contract (`14624` terminal), log
  `/tmp/texttext-template-release-gates-links-fixed.log`. The corrective source
  now generates the hosted 27-tool catalog from the actual vault registry,
  checks OAuth resource discovery, and gives local evaluation disposable file
  storage. Actual MCP discovery/catalog/resources/prompts/revocation/replacement
  acceptance passed; `/tmp/texttext-mcp-discovery-live-check.log`. TypeScript,
  docs verification and generated-doc checks passed. Update the clean candidate,
  then resume full release checks. Revalidate sync receipts and rebuild/package the exact
  new candidate source before deployment; the existing archive is older.
  Oracle remains on `cce4206c`, unchanged. Preflight
  verified 27 GB free, recent backups and all TextText/Algorave services active.
  Candidate archive:
  `.texttext/oracle/texttext-223954b8-templates.tar.gz` in that clean clone.

- Matching native snapshot/template validation now lives in the shared
  `BuiltinTextPackDocument.validateMetadata`, consumed by the agent and by the
  actual custom creation store. Direct store callers cannot bypass metadata,
  title/body and unimported-asset checks. Agent, local-vault and local/remote
  document suites passed; `/tmp/texttext-custom-create-store-validation.log`.
  Source only, not installed. Reusable-library authoring still remains.

- Desktop folder-agent `create_file` now accepts complete matching custom
  snapshot/template JSON. Native packages prepare metadata before publication
  through the checksum-pinned creation journal, including metadata in retry
  intent. Windows builds one complete imported package through the shared
  transport. Title/body/reference mismatch and unimported asset references
  refuse before writing. Native agent/local-vault suites: 33 tests passed;
  Windows adapter: eight passed; Mac-run Windows native agent suite and
  TypeScript passed. Logs `/tmp/texttext-agent-custom-create-{verified,types}.log`,
  `/tmp/texttext-windows-agent-custom-create.log`,
  `/tmp/texttext-native-windows-custom-create.log`. Source only: no installed
  custom-creation or Windows lost-response durability claim. Higher-level
  reusable template authoring/version/apply workflows remain unfinished.

- Both shared editor modes now prepare saved-look metadata through
  `src/local-vault/saved-look.ts`. Complete validated snapshots, independent
  template identity and retained editable blueprint provenance are prepared
  before the existing atomic clone. Source title/body/fields/theme are preserved.
  Three transport/preparation suites: 48 tests passed; additional provenance
  regression passed (all three preparation tests); TypeScript passed. Logs
  `/tmp/texttext-shared-look-{tests,provenance,types-final}.log`. Source only;
  native agent-library commands are still unfinished.

- Mac 1214 candidate build and installation completed with exit 0. The build
  and installer handles `26612`/`71689` are terminal; do not resume or restart.
  See the installed acceptance receipt above. Runtime health remains
  sandbox-private. No public release.

- Creation recovery also verifies its recorded destination against the
  original requested folder/title before publishing. A corrupted intent cannot
  redirect a prepared file into another workspace folder. Agent-file/local-vault
  suites: 32 tests passed; `/tmp/texttext-creation-destination-fence.log`.
  Source only; no installed runtime acceptance claimed.

- Prepared creation intents now pin the package checksum before publication.
  Resumption refuses changed staging bytes and retains them for recovery.
  Version-1 journals still find already-published identities; unverified legacy
  staging is preserved and refused rather than published. Agent-file and local
  vault suites: 31 tests passed, including intact resumption, tampered staging,
  legacy behavior and concurrent creation. Log
  `/tmp/texttext-prepared-creation-integrity-final.log`. Source only.

- Native agent creation now uses the existing durable CLI preparation journal.
  App-server call retries receive a stable key; agents may supply a stable
  intent key across calls. Rename/edit retries preserve the original identity
  and later edits; deleted identities and changed intent refuse recreation.
  Recovered paths are rechecked against the active folder boundary. Native
  agent/controller and local/remote document suites: 106 tests passed.
  Log `/tmp/texttext-native-agent-creation-retry.log`. Source only, not installed.
  This uses local process locking, not a distributed iCloud lock.

- Hosted workspace-root agent tasks now offer the reusable template library
  commands through both cloud adapters, proposal staging and the canonical
  executor. Named-folder tasks remain fenced, including a task targeting
  `Templates`; ordinary account permissions and owner approvals still apply.
  Actual file-engine creation/update/remix approval tests cover root scope,
  expired lost-response recovery without duplicate writes and access revocation.
  Four targeted suites: 84 tests passed (43 proposal tests rerun after correcting
  a missing idempotency key in the new refusal fixture); TypeScript passed.
  Logs `/tmp/texttext-root-template-{tests,proposals,types}.log`.
  Source only: Oracle deployment and native reusable-library tools remain.

- Save as look now supplies complete metadata to clone creation, eliminating
  the second write and partial library item on failure. Mac customizes only a
  private clone before publication; web/Windows encode the complete new identity
  before one commit. Source content, assets/opaque entries and receipt isolation
  remain covered. Seven native recovery tests, 17 shared-editing tests, 333 shared
  tests (before the additional Windows-specific test), 46 targeted transport tests,
  TypeScript and focused browser Save as look acceptance passed. Source only;
  Windows installation remains; verified candidate cce4206c includes the fix.
  Native installed 1213 save/library discovery and deployed Safari save with
  local iCloud arrival passed. Logs
  `/tmp/texttext-atomic-look-{native,shared-editing,client-all,transports,types,browser}.log`.

- Mac agent creation now rejects invalid explicit item types before publication,
  matching Windows. All 15 agent-file tests passed, including each supported
  type and invalid string/non-string refusal with no draft. Installed in 1213.
  Log `/tmp/texttext-agent-kind-parity.log`.

- Mac agentStatus now checks retained runtime authorization once on first use.
  Signed-out discovery never starts browser login or repeated runtimes; explicit
  disconnect is not undone by status reads. Explicit Connect still starts login.
  All 18 controller regressions passed; installed 1212 actual acceptance passed.
  Log `/tmp/texttext-agent-account-restore.log`.

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
  and TypeScript passed. Verified Windows candidate acc63214 includes this fix; installation remains.
  Logs `/tmp/texttext-windows-agent-folder-default{,-types}.log`.

- Native agent creation no longer forces built-in Note when kind is omitted.
  It inherits the selected folder default through the ordinary DocumentStore
  creation path. Regression proves inheritance, explicit Note override and
  unchanged design-file hash; 14 agent file tests passed. Installed 1211/1212
  actual inheritance passed. Log `/tmp/texttext-agent-default-template.log`.

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

- Commercial ChatGPT account sign-in is deferred at the owner's request
  (2026-10-08) and does not block this version's readiness. Registration/client
  ID remains unavailable. Google sign-in is not configured on Oracle. Actual
  signed-in Safari inspection confirmed the existing Texttext web client in
  Google project `project-9ddb389f-8f22-482d-abf`, with the correct production
  callback and an enabled masked secret. Presence-only checks found neither
  Google runtime variable on Oracle or in Mac `.env.local`; the expected
  `texttext-google-oauth` Keychain entry is absent. Replacement-secret approval
  is pending; no console or runtime setting was changed. Audit:
  `/tmp/texttext-google-configuration-audit.md`.
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
