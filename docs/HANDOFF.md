# TextText handoff

## Installed and live

- Mac `/Applications/TextText.app`: **0.204 (1195)**, source `94cef4ea`.
  Preserved account/iCloud workspace and existing note at startup. Live asset
  checks pending. Startup/search/save/reopen passed in the actual app.
  Parent selection and save-before-navigation/reopen passed in the actual app.
  [Receipt](verification/2026-10-08-parent-native-contract.md).
- Windows: source `f3167c4b`, installed in the existing location. Preserved note,
  account identity and search passed. [Receipt](verification/2026-10-08-windows-shared-1191.md).
- Oracle: **texttext-oracle-20261008T121823Z-94cef4ea**, thirteen live checks passed.
  Previous release retained; TextText/Algorave remain active and shared config
  timestamps are unchanged. Fresh backup `texttext-20261008T105710Z-d08da82e.dump`.
- Live 1188 acceptance found a permission-only listing notification gap in both
  native adapters. Build 1189 fixes it with controller/engine regressions.
  Mac save/search/reopen and automatic Mac-to-Windows/web and Windows-to-Mac/web
  marker delivery passed; local TextPack contains both markers exactly once.
  [Current receipt](verification/2026-10-08-workspace-capabilities-1189.md).
- Accounts, existing notes, saved edits and search freshness passed on installed
  clients. Agent-created template item arrived on both desktops automatically;
  Safari opened the same item with Mac/Windows presence.
  [Current receipt](verification/2026-10-08-reconnect-customize-1187.md),
  [Windows receipt](verification/2026-10-08-windows-shared-1187.md).
- Mac folder:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Only dedicated verification notes changed during acceptance.

## Current work

- Candidate 1195 installed on Mac and deployed on Oracle; frozen core/native/
  browser checks and startup/search/save/reopen passed. Windows candidate is
  verified but the older installed app remains running. Live native folder
  review caught a 201-status relay defect; source fix passes 17 relay tests but
  needs build/install/live acceptance. Stable proposal staging retries and the
  Oracle shutdown timeout remain open. [Receipt](verification/2026-10-08-candidate-1195.md).

- Integrated folder cohort core gate passed 795 tests in 84 files plus TypeScript
  (`/tmp/texttext-folder-integrated-core.log`). Unrelated working edits were
  present, so this is not a frozen release receipt. Follow-up closes a gate
  fingerprint gap: Windows native desktop source now invalidates stale receipts;
  generated outputs/downloaded runtime remain excluded. Seven gate tests pass.
  Freeze a clean candidate and rerun required gates before install/deployment.

- Shared folder dialog is wired into the folder More menu for file managers.
  It validates destinations, stages the canonical reviewed move and opens an
  owner review link, using the native workspace origin on desktop. Folder or
  workspace departure closes stale UI. Nine focused tests, TypeScript and a
  full-app Chromium fixture passed, including light/dark visual inspection.
  Mandatory core/browser suites include the new checks. No actual install or
  live folder move is claimed. Pending-edit readiness, frozen gates and live
  native/web review acceptance remain before shipping.

- Desktop folder-review transport is wired: Mac uses a bound authenticated
  request builder with exact source/destination keys and a bounded response;
  Windows reuses the shared web transport through workspace-restricted native
  HTTP. Mac request/collaboration suite passed 16 tests, Windows transport
  passed 11 tests and TypeScript passed. Source-only. Shared folder dialog,
  pending-edit readiness checks and live review/install remain pending.

- Owner folder-move staging API and web transport are implemented. The route
  requires fresh owner authorization and a trusted app/session capability;
  generic sync tokens cannot use this human action. It accepts source/destination
  only and creates the canonical stored review without moving files. Auth,
  route and web transport suites passed 45 tests plus TypeScript. Native
  transports and shared folder dialog remain pending; source-only.

- Shared folder-control preparation: durable proposals now retain human versus
  agent initiation through approval/retry; reviewed folder execution records
  human actions correctly instead of always marking an external agent. Proposal
  suite passed 35 tests, boundary attribution passed 3 and TypeScript passed.
  The boundary test is included in the core gate. Folder menu/transport wiring
  remains pending; no install/deployment is claimed.

- Active-editor remote-move regressions passed: 32 Mac sync tests, 14 Mac
  shared-editing tests and 174 Windows core assertions. Pending shared projection
  remains protected across restart; acknowledged bytes adopt the remote path
  after editor release without duplicate upload. Source fixtures only. Shared
  folder controls, frozen builds and live multi-client acceptance remain next.
  [Evidence](verification/2026-10-08-remote-folder-move-native.md).

- Mac persisted uploads now adopt path-only remote moves with bounded identity
  indexing, fresh permission and base/lifecycle checks, preserving staged
  attribution and later edits under a new operation identity. All 31 sync tests
  passed, including interrupted adoption, permission restoration and lost ACK.
  Source-only; active editors and live multi-client moves remain pending.
  [Evidence](verification/2026-10-08-remote-folder-move-native.md).

- Persisted Windows uploads now follow path-only remote moves using a fresh
  operation identity, preserving staged and later local edits. Regression first
  reproduced the conflict; 171 portable core assertions passed, including
  interrupted adoption, changed remote content, revoked permission and lost ACK.
  Source-only. Mac persisted-outbox ordering and active editor checks remain next.
  [Evidence](verification/2026-10-08-remote-folder-move-native.md).

- Remote-move verification exposed a Windows path-adoption bug with concurrent
  offline edits. Windows now carries local bytes to the remote path before
  upload and recovers interruption before baseline save. Path-strict Windows
  tests passed 164 assertions; all 27 Mac sync tests passed. The native gate now
  requires the portable Windows core suite, and its fingerprint includes those
  sources/tests. Mandatory native verification passed. This remains source-only;
  persisted-outbox/active-editor orderings and shared folder controls need
  acceptance before shipping. PC still has TextText process 44968 running; do
  not force-close its uninspected editor. [Evidence](verification/2026-10-08-remote-folder-move-native.md).

- Canonical `move_folder_tree` now stages a frozen file/folder/access review and
  executes it through the durable store only after owner approval. Approval saves
  the review hash and access acknowledgement atomically; receipt-only expiry is
  forwarded correctly. Real local PostgreSQL hosted-to-execution acceptance and
  the mandatory core gate passed 772 tests in 81 files plus TypeScript. This is
  source-only; shared folder action UI, frozen release gates and live deployment
  acceptance remain pending. [Evidence](verification/2026-10-08-folder-move-recovery-source.md).

- Proposal reviews now provide a return link to the server-authorized workspace.
  The page/service suites passed 47 tests and TypeScript passed. This navigation
  follow-up is source-only; it has not been deployed.

- Live Mac 1193 acceptance found an empty parent picker: native listings provide
  paths, not document IDs/titles. The shared picker now uses bounded search and
  freshly resolves only the selected TextPack before saving its stable identity.
  Existing references resolve saved titles on reopen. Ten focused tests,
  TypeScript and both browser flows passed, including the path-only full-app
  fixture. Mac 1194 is installed with actual parent selection/navigation/reopen
  verified. Windows passed 302 shared tests and desktop smoke; its running editor
  must close normally before installation. Oracle deployed with thirteen passing
  checks. Actual Safari parent navigation saved its edit and delivered it to Mac.
  An initial deployment-time page error cleared on reload; cause remains unproven.
  [Evidence](verification/2026-10-08-parent-native-contract.md).

- Frozen candidate `8621dd0c` passed 759 core tests, TypeScript, required native
  suites, 16 proposal-review tests and both Note browser flows. It contains the
  versioned Note parent picker/navigation and preset-generation build guard.
  Oracle is deployed and actual Safari review verified. Mac 1193 is installed
  with actual startup/search/save/reopen verified. Windows passed 299 shared-client
  tests and desktop smoke; installation remains pending. Windows SSH works again,
  but its running editor must close normally before installation.
  [Candidate evidence](verification/2026-10-08-parent-review-cohort.md).

- Canonical `remix_item_type` is committed as `626ee884`, with pinned source
  authorization and durable retries; shipped in 1190. Focused suites passed 56
  tests, with a final 21-test recheck and TypeScript.
  [Receipt](verification/2026-10-08-agent-template-remix.md).
- Shared folder defaults, atomic complete-item creation and reversible template
  retirement are committed in `197c7552`; local/remote CLI parity is covered by
  `eaf1c25e`, `5f74d92a` and `af658589`. These changes shipped in 1190.
  Explicit template choices override defaults; existing items retain their design.
- Candidate source `5254ff85` passed 662 core tests, TypeScript and native
  sync/creation suites. Mac 1190 and Oracle are installed; Windows verification
  is completing on the same source.
  Server/Windows `a0d9391b` and native `163b9a02` remove aggregate folder scan
  limits, cache bounded metadata, and test external change/rename invalidation.
  [Source receipt](verification/2026-10-08-folder-default-retirement-source.md).
- 1191 source `f3167c4b` passed 725 core tests, TypeScript and required native
  checks. It includes custom-field updates, bounded account-profile recovery and
  explicit CLI proposal staging. Clients and Oracle installed; live proposal/field acceptance passed.
  [Receipt](verification/2026-10-08-cli-proposals-live.md).
- Next cohort: atomic agent image addition (`8aae3f12`) and reference removal
  (`a3c2bad5`) are committed and focused-tested, not shipped. Originals stay in
  the TextPack for recovery. Web image approval support is in progress.
- Candidate 1192 freezes `4e1c218b`: image import approvals, asset removal,
  web folder customization and concise proposal completion. Exact-source gate
  passed 737 tests, TypeScript and required native checks. Initial `4df98955` gate caught an obsolete tool-exclusion assertion;
  the correction tests proposal-only execution with no fetch before approval.
  Mac 1192 installed; Oracle deployment passed all thirteen live checks. Windows candidate passed but
  installation awaits PC SSH recovery; existing Windows app remains 1191.
- Durable folder move/rename is being implemented with filesystem recovery and
  coordinated grant migration. Legacy SQL folder commands remain unavailable to
  canonical agents until this is complete; do not compose partial per-item moves.
  Engine recovery and store coordinator are now implemented and focused-tested;
  public approval/client integration remains pending.
  Reservation and receipt replay now bind the full reviewed plan, with twelve
  focused tests and TypeScript passing; this follow-up remains source-only.
  Content-boundary preview/execution wrappers now check owner access, current
  manifests, retained review hashes and explicit access expansion acknowledgement.
  Required core verification includes the real PostgreSQL boundary/reservation
  tests and passed 765 tests plus TypeScript. Public proposal/client integration
  is still pending; this cohort is not installed or deployed.
  The boundary now returns a validated frozen review with readable path/count
  and additional-access summaries. Full-plan and lifecycle regression checks
  pass; public staging/approval wiring remains the next integration step.
  Additional-access acknowledgement is implemented in the review page and checked
  before server claim. Public folder staging/execution and live UI acceptance
  remain pending; no folder command has been enabled or deployed by this cohort.
  [Source evidence](verification/2026-10-08-folder-move-recovery-source.md).


- Source `54f33a4e` passed 588 core tests, TypeScript and required native gates.
  Agent template creation and durable template/folder approvals
  now use canonical file operations and retry receipts.
- Shared reader optimizations reduced the bounded 525 KiB note open from
  1.5–1.6 seconds to 170 ms; cached reopen measured 254 ms. Unchanged
  status/presence no longer reparses Markdown. Actual edits still invalidate.
  [Performance evidence](verification/2026-10-07-file-vault-bounded-performance.md).
- Shared frozen-content template previews, web item Customize and guarded
  application approvals are installed. Folder customization remains native-only.
- Immediate automatic reconnect probes, bookmark baseline release and fresh
  shared discovery permission checks are installed.
- Installed workspace switching includes account discovery, fresh membership
  authorization, commit-time editor flush, and shared permission-aware UI.
  Windows changes through `54f33a4e` pass 161 Core assertions and crosscompile;
  shared UI `a5dc4d6a` passes focused unit/browser checks and TypeScript.
  Mac `43614e64` includes persisted offline capability handling. The integrated
  gate passed 588 core tests and required native suites; Windows passed 269
  shared-client tests and actual desktop smoke. Owner-capability HTTP fixture
  `d17b0052` passed the real native two-vault contract check. Native and Safari
  account menus list the current workspace; live cross-workspace switching is
  not attested because this account has one workspace.
- Core gate now also includes bookmark retention regressions (`0cbe0914`).
- Owner-approved obsolete deployment cleanup restored Oracle free space;
  retained current/rollback/candidate, all content and backups. No cleanup job.
- Automatic request/bootstrap recovery and graceful read-poll shutdown are
  installed. [Recovery receipt](verification/2026-10-07-recovery-templates-1184.md),
  [shutdown evidence](verification/2026-10-07-read-poll-shutdown.md).
- Standalone CLI `5254ff85` remains installed; real account commands and template
  create/update/retry work while local reads stay offline.
  [CLI receipt](verification/2026-10-07-cli-account-commands.md).
- No web provider is configured; live model execution is not attested.

Keep one canonical file system and shared UI/editor/sync implementation across
Mac, Windows and web. Native adapters handle filesystem, credentials and OS
integration. Legacy data migration is explicitly out of scope; no deletion is
needed to stop using legacy content paths. Home List/Cards already shares items
and actions, with a personal per-device/workspace preference.

## Remaining scope and external limits

- [Agent command inventory](agent-file-backend.md).
- [Reference-template parity audit](design/template-reference-parity.md).
- Google client exists but its secret is unavailable; Oracle Google sign-in is
  not configured. Commercial ChatGPT sign-in requires OpenAI registration that
  the owner does not yet have.
- Integrated workspace switching acceptance remains incomplete. Windows live folder-picker
  acceptance is deferred; isolated native checks passed.
- Second physical Apple-device iCloud delivery, Windows provider eviction and
  hardware power loss are not live-certified.
- Required existing `Shoku's Space/My Notes/TextText Changelog.textpack` was not
  found. Do not create a duplicate. Standalone CLI receipt:
  [current CLI](verification/2026-10-07-standalone-cli-current.md).

## Working conventions and evidence

- [Sync subsystem contract](../sync/README.md) and exact-source gates cover
  journals, external edits, epochs, recovery, acknowledgements and sessions.
  Reuse unaffected receipts; verify relevant changes.
- Preserve unrelated edits in `src/components/workspace/assistant/attachments.ts`,
  `src/lib/workspace/__tests__/tabs.test.ts`, `scripts/.probe-editor.ts` and the
  existing Python cache. Coordinate concurrent edits before staging.
- Local client installs and needed Oracle deployments are authorized. Public
  desktop releases require an explicit request. No automated build/install jobs.
- [Archived implementation history](verification/2026-10-07-handoff-before-shared-templates.md).
