# Superseded handoff history

Historical investigation notes, not current installation or readiness status.

# TextText handoff

## Installed and live

- Mac `/Applications/TextText.app`: **0.204 (1206)**, source `3a115301`.
  Signed build/install, account/iCloud startup and saved Gallery model metadata
  reopening passed. [Current Mac receipt](2026-10-08-mac-1206.md).
  Real native Gallery image description and metadata write passed. The Safari
  checkpoint rejection is fixed and live reopening passed.
  [Web follow-up](2026-10-08-gallery-web-checkpoint.md).
  [Current acceptance and failure](2026-10-08-gallery-agent-1204.md).
  Exact-source core/native gates, signed build and observed account/iCloud/note
  startup passed. [1203 receipt](2026-10-08-mac-1203.md).
  Preserved account/iCloud workspace and existing note at startup. Live asset
  checks pending. Startup/search/save/reopen passed in the actual app.
  Parent selection and save-before-navigation/reopen passed in the actual app.
  [Receipt](2026-10-08-parent-native-contract.md).
  Latest core/native/browser gates, startup, existing note save/reopen and
  search freshness: [1202 receipt](2026-10-08-mac-1202.md).
- Windows: source `f3167c4b`, installed in the existing location. Preserved note,
  account identity and search passed. [Receipt](2026-10-08-windows-shared-1191.md).
- Oracle: **texttext-oracle-20261008-3a115301-gallery**, thirteen live checks
  passed. Mac photo tags are present in the actual Safari editor. The outgoing
  server exited 143 immediately without timeout/SIGKILL.
  [Current deployment](2026-10-08-oracle-gallery-1206.md).
  An additive systemd override now classifies graceful 130/143 exits correctly;
  no restart was needed. [Service receipt](2026-10-08-oracle-normal-exit.md).
- Live 1188 acceptance found a permission-only listing notification gap in both
  native adapters. Build 1189 fixes it with controller/engine regressions.
  Mac save/search/reopen and automatic Mac-to-Windows/web and Windows-to-Mac/web
  marker delivery passed; local TextPack contains both markers exactly once.
  [Current receipt](2026-10-08-workspace-capabilities-1189.md).
- Accounts, existing notes, saved edits and search freshness passed on installed
  clients. Agent-created template item arrived on both desktops automatically;
  Safari opened the same item with Mac/Windows presence.
  [Current receipt](2026-10-08-reconnect-customize-1187.md),
  [Windows receipt](2026-10-08-windows-shared-1187.md).
- Mac folder:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Only dedicated verification notes changed during acceptance.

## Current work

- Windows candidate `c3c3ed2d` passed the actual PC build, native suites, 327
  shared-client tests and desktop smoke. It includes the native image input and
  optional-image checkpoint fix. Installation remains pending closure of the
  older app, whose unsaved state is unknown.
  [Current candidate receipt](2026-10-08-windows-c3c3ed2d-candidate.md).

- Web Gallery rejection root cause reproduced from the exact Oracle pack and
  checkpoint: valid optional image caption/poster omissions were encoded as
  JavaScript undefined and rejected by the strict checkpoint JSON validator.
  New shared asset snapshot/mutation writes now omit undefined properties.
  Existing asset values are strictly schema-validated before accepting only
  optional omissions; unknown and required-field omissions remain rejected.
  The copied production checkpoint now reads with the same epoch/sequence.
  Thirty-seven focused tests passed, including persisted checkpoint reopening
  with unchanged file bytes. Logs: `/tmp/texttext-gallery-optional-store-tests.log`,
  `/tmp/texttext-gallery-optional-checkpoint-types.log`. Installed in Mac 1205
  and deployed to Oracle; actual Safari editor and saved model summary reopened
  without rejection. [Live receipt](2026-10-08-gallery-web-checkpoint.md).

- Oracle connection retirement is deployed and its clean shutdown is attested.
  Detailed Gallery photo resizing and single-photo metadata editing are installed
  in Mac 1206 and deployed on Oracle. Windows candidate `73740adb` is building;
  log `/tmp/texttext-windows-73740adb-build.log`. [Photo input receipt](2026-10-08-gallery-photo-input-budget.md).

- Native Gallery photo input is now wired in source for Mac and Windows. The
  shared UI reads the exact selected embedded asset and prepares the existing
  bounded JPEG input; closing or retargeting during decode fences the send.
  Controllers validate embedded JPEG shape/size and attach it only to that turn.
  Mac's fourteen controller tests and Windows agent tests passed, including
  external/malformed/oversized refusal and exact image attachment. TypeScript
  and the rebuilt offline browser fixture passed; the latter actually sends a
  Gallery photo through the native bridge and checks original bytes unchanged.
  Logs: `/tmp/texttext-native-photo-swift.log`,
  `/tmp/texttext-native-photo-windows.log`, `/tmp/texttext-native-photo-ui-send.log`.
  The shared suggested task also explains native read_file/write_file metadata
  updates with exact hash fencing. These native changes are not installed yet;
  actual configured-provider generation, metadata writing and sync acceptance
  remain required.

- Hosted Gallery tasks now pass the exact selected embedded image through the
  existing AI attachment input. A bounded JPEG preview is prepared without
  fetching source URLs or changing original bytes. Missing/ambiguous images
  fail explicitly, and cancellation during decode cannot send a request.
  Selected photo ID and suggested prompt persist in the item task through
  restart/phase changes; a different photo cannot overwrite an existing draft.
  Seventeen unit tests, TypeScript, the full rebuilt offline UI fixture and
  Gallery browser gate passed. Browser conversion verifies the selected blue
  image rather than its red neighbor, width 1600, byte bound, preserved source
  and cancelled-decode fencing. Logs: `/tmp/texttext-gallery-vision-unit.log`,
  `/tmp/texttext-gallery-vision-context-browser.log`,
  `/tmp/texttext-gallery-vision-browser-gate.log`. Source changes remain
  installed on Mac 1203 but undeployed on Oracle/Windows. Native selected-image
  input wiring remains needed. Actual configured-provider generation and approval
  still require end-to-end acceptance; these tests do not prove model output.

- Gallery inspector now has Describe with agent. It closes the viewer and
  opens an editable task for that TextPack and exact stable photo asset ID,
  preserving neighboring assets and requiring actual visual inspection before
  metadata generation. The shared folder/grid/import paths pass the callback.
  TypeScript and the rebuilt full offline browser fixture passed; the fixture
  verifies selected photo ID in the composer and no automatic agent send
  (`/tmp/texttext-gallery-agent-action-browser.log`). Source only, not installed
  or deployed. Hosted assistant already supports bounded image attachments,
  but the selected image still needs to be wired into that path; visual
  generation itself is not verified.

- Agent `update_item` now accepts validated `asset_metadata` for one image's
  summary/tags by stable asset ID, with mandatory current revision. The shared
  Yjs mutation validates before any content/receipt changes, preserves image
  references and neighbors, and replays an operation once. File MCP regression
  writes an actual TextPack, verifies original asset bytes, replays once and
  rejects a stale revision. Fifty relevant tests and TypeScript passed
  (`/tmp/texttext-agent-image-metadata-final.log`). Legacy non-file backend
  explicitly refuses this operation. Gallery UI action and visual input to
  hosted agents still need integration; no install/deploy yet.

- Gallery metadata now reads the latest TextPack before writing and merges only
  the viewer's changed fields. Concurrent edits to other photos, body, custom
  fields, asset order and added images survive. Competing edits to the same
  field or replacement/removal of that image refuse the write and retain the
  draft; the final write still fences the freshly read revision. Eight focused
  regressions and TypeScript passed. Rebuilt current local UI passed the full
  offline browser fixture, including a real viewer save after another photo's
  summary changed (`/tmp/texttext-gallery-metadata-browser-current.log`). Source
  change is not installed or deployed yet. Gallery agent-generated metadata
  remains unfinished; this change provides the safe manual write path first.

- Windows candidate now matches installed Mac 1202 source `c58114ad`. The actual
  PC build, 326 shared-client tests and desktop smoke passed. Installation
  remains pending closure of the older app with unknown unsaved state.
  [Candidate receipt](2026-10-08-windows-c58114ad-candidate.md).

- Oracle HTTP shutdown lifecycle is deployed; actual Oracle shutdown remains
  unverified. A raw TCP
  socket without HTTP headers reproduced standalone shutdown exceeding 12
  seconds while the active long poll had already finished. The lifecycle now
  closes only sockets that have never entered an HTTP request handler. With
  that socket and an active 25-second poll, standalone production exits 143 in
  6020 ms without SIGKILL (`/tmp/texttext-prerequest-drain.log`). Active responses
  remain untouched. Actual Oracle cause and shutdown fix still require proof.
  The entry point
  uses Node HTTP diagnostic channels to report fixed request categories/counts/
  ages and inbound socket counts at shutdown, with no private request data and
  no executing-request cancellation or exit changes. Real HTTP regression proves unfinished versus
  idle distinction, response completion cleanup and observer disposal. Oracle
  suite passed 23 tests, one environment-dependent restore test skipped
  (`/tmp/texttext-shutdown-diagnostics-tests.log`). Next normal rollout must
  install this, then inspect its evidence on a subsequent shutdown; do not
  infer production completion solely from the standalone result.

- Windows explicit recovery now serializes verified-copy checks and journal
  release under the same store mutation lock as checkpointing/relocation.
  Interrupted move intents are archived byte-for-byte and removed before the
  checkpoint, preventing a retained move from reviving released state. The
  regression starts a move intent, explicitly recovers to a distinct verified
  file, and checks exact archive bytes plus released protection. Full Windows
  Core suite passed on Mac (`/tmp/texttext-recovery-store-lock-windows-final.log`).
  Actual PC full Core suite also passed from isolated source `5767b4ba`
  (`/tmp/texttext-recovery-actual-pc.log`), including serialization-only replay
  and exact move-intent archival. Updated installed-client acceptance remains
  required; no existing PC user state changed.

- Native same-generation replay now compares complete journal JSON values,
  allowing serialization-only formatting/key-order changes while retaining
  generation, projection and content checks. Mac replay returns the original
  checkpoint; Windows also compares every non-journal checkpoint field.
  Existing divergence and stale-generation refusals remain covered. All 17 Mac
  shared-editing tests and the full Windows Core suite passed on the Mac.
  Logs: `/tmp/texttext-semantic-journal-mac-final.log`,
  `/tmp/texttext-semantic-journal-windows.log`. These follow-up native changes
  are not included in installed Mac 1201 or the waiting Windows candidate.

- Windows actual PC candidate now matches Mac 1201 source `2f959327`:
  `C:\Users\Shokunin\dev\texttext-build-2f959327\windows\build\candidate-6f629e8c15ef4ca0ad362b1929c4520a`.
  Full native core/agent suites, shared client suite, TypeScript, bundled UI,
  publish and actual desktop editor/close/activation smoke passed.
  Log: `/tmp/texttext-windows-2f959327-build.log`; smoke receipts remain beside
  the candidate. Installed old process 44968 is still running with no reported
  window title. Installer refuses running processes to protect unsaved edits;
  owner has been asked to save/close it. No PC user state was overwritten.
  Latest Oracle rollout still hit the old process's 30-second SIGTERM timeout;
  graceful drain remains unresolved, despite the successful replacement/live
  checks. Do not infer it fixed from isolated production probes.

- Mac 1201 installed from `2f959327` after 814 core tests, TypeScript and all
  native sync gates. Signed bundle and all three extensions validate. Actual
  startup preserved account/iCloud workspace and reopened the moved note
  without journal divergence. Edit, Finish, home navigation and second reopen
  retained all original lines plus `Reopen save verification 1201.`. Search
  immediately finds that newly saved body text at the 1200 path; Escape returns
  to the note. CLI independently reads the stable identity and saved content.
  Logs: `/tmp/texttext-relocated-reopen-corrected-gates.log`,
  `/tmp/texttext-mac1201-build.log`, `/tmp/texttext-mac1201-install.log`.
  Runtime health remains sandbox-private; this is actual UI acceptance.
  Windows build/install and web deployment of the journal-selector change
  remain pending. Earlier failure paragraphs below document superseded source
  investigations; the moved verification note is now editable and saved.

- Oracle `da36425d` deployed after 813 core tests and native exact-source gates;
  thirteen live checks passed and Algorave stayed active. Package/deploy logs:
  `/tmp/texttext-folder-content-oracle-package.log`,
  `/tmp/texttext-folder-content-oracle-deploy.log`.
  Fresh review `0882e342-25ba-4c1d-89d5-b19692d87614` completed in Safari while
  Mac 1200 kept its editor open. The item followed 1199 to 1200 automatically;
  text typed after review was retained. Finish saved all three lines, stable
  ID `466761a0-c4e2-4fad-8214-c976fcc30a7a`, hash
  `3fd1ef5784a53fa08af51016a2d234e788c8133daf21677066aae3e7dc8e4b21`;
  old file path is absent. Reopen FAILED with equal-generation journal
  divergence: native path rebased but browser retained the old path.
  Source follow-up accepts only a path-only difference attested by the native
  same-item open session, with every other journal field equal. Genuine state
  divergence remains fail-closed. Offline reopen regression preserves pending
  text; 55 collaboration tests and TypeScript passed. New Mac build/install
  and real reopen acceptance are required; the current recovery screen is
  intact and saved TextPack contains all verification text.

- Folder move approval no longer rejects ordinary document edits or unrelated
  workspace changes solely because the global manifest revision advanced.
  Execution rechecks exact subtree identities/paths, empty folders and
  destination availability; grant reservation still validates the complete
  approved access transition. The intent snapshots current bytes under the
  engine lock. Regression types after review, interrupts completion, recovers
  edited bytes and proves one audited replay. Twelve engine tests, both actual
  local PostgreSQL boundary/access tests and TypeScript passed. Logs:
  `/tmp/texttext-folder-move-content-tests.log`,
  `/tmp/texttext-folder-move-content-db.log`,
  `/tmp/texttext-folder-move-content-tsc.log`. Live proposal is not yet recovered
  and this source is not deployed.

- Installed Mac 1200 recovered the retained verification note at its 1199
  location. Live pending-edit move proposal
  `01ce878c-5874-4c9a-8e11-c54b932aa872` remains unconfirmed; the editor still
  retains original text and `Active editor move verification 1200.` at the
  old path. Do not close or replace this editor before saving/verifying its
  draft. The review incorrectly implied ongoing work without a confirmed
  live execution. Source now describes an unconfirmed result and offers
  recovery only for a server-attested durable operation, using the same
  stored proposal and idempotency key. 56 focused proposal/review tests and
  TypeScript passed. Oracle deployment and live recovery remain pending.
  Exact-source `a65465b8` gates passed 811 tests plus native checks; Mac build
  and install logs: `/tmp/texttext-mac1200-build.log`,
  `/tmp/texttext-mac1200-install.log`. Windows candidate from the same source
  passed the actual PC build/smoke workflow (325 shared tests plus native
  suites); not installed while old process 44968 has unverified unsaved state.
  Log: `/tmp/texttext-windows-a65465b8-build.log`.

- Actual PC native acceptance passed for source `adf8d21a`, using the existing
  TextTextBuild SDK in isolated directory
  `C:\Users\Shokunin\dev\texttext-rebase-adf8d21a-20261008`.
  Full Windows Core suite passed, including active same-token save after a
  move, reopen with pending journal, move crash recovery and pre-checkpoint
  deferral (`/tmp/texttext-rebase-actual-pc.log`). No installed app, account,
  user files or SDK configuration changed. Updated desktop build and real
  shared-editor UI acceptance are next; public releases remain unauthorized.

- First-checkpoint startup window now has native regressions on both desktops:
  an early remote move is safely deferred before the first journal, then the
  ordinary next sync relocates the newly durable pending projection with its
  session intact. Mac 17 shared editing tests and the full Windows Core suite
  passed (`/tmp/texttext-first-checkpoint-mac.log`,
  `/tmp/texttext-first-checkpoint-windows.log`). Actual installed acceptance
  remains pending; no new client was installed for these source changes.

- Windows recoverable move is now wired into the protected sync path.
  Checkpoints and moves serialize through the store mutation lock; the lock
  is released before awaiting the sync gate. A session rebases from its
  recovered checkpoint, while acknowledgement resolves the current bounded
  baseline location. Full Windows Core regression suite passed on Mac:
  same-token save after remote move, pending updates without snapshot upload,
  reopen at new path, both move interruption windows and occupied destination
  refusal (`/tmp/texttext-windows-active-rebase-core.log`). Actual PC execution
  and integrated UI/native acceptance remain pending. Live sessions before
  their first checkpoint are covered by explicit safe-deferral tests on both desktops.

- Shared UI now relocates selected items only by a unique stable identity,
  preserving the editor boundary and drafts when paths move. Local read
  recovery follows the same identity before treating a missing path as
  deletion. Native collaborative checkpointing keeps its session mounted.
  Draft keys are identity-based with a preserved legacy-draft migration.
  Browser acceptance passed for typing immediately before a move and saving
  at the new path without recreating the old file; existing note-template
  creation/editing passed, 13 focused tests and TypeScript passed. Logs:
  `/tmp/texttext-open-item-move-browser.log`,
  `/tmp/texttext-item-move-note-browser.log`,
  `/tmp/texttext-item-location-tests.log`,
  `/tmp/texttext-item-location-tsc.log`. Regression is in the normal note
  browser command; identity tests are in core/client sync gates. Windows
  journal rebasing and real installed shared-editor acceptance are pending.

- Shared journal path rebasing now has a recoverable move intent on Mac.
  Both interruption windows preserve file bytes, pending updates and journal
  generation; occupied destinations are refused. All 16 shared editing tests
  passed (`/tmp/texttext-shared-rebase-tests-final.log`). This primitive is now
  wired into Mac sync for unique unchanged shared projections, retaining the
  session token and pending journal. A checkpoint prepared before the move
  adopts the actor-owned current path. Active-session save and restart passed;
  all 16 shared editing and 33 native sync tests passed
  (`/tmp/texttext-active-rebase-tests.log`,
  `/tmp/texttext-active-rebase-sync-tests.log`). Windows equivalence, live
  sessions before their first checkpoint, and selected-editor identity/path
  updates remain required before deployment. The UI still interprets a
  missing old path as deletion and keys its boundary by path; fix that before
  claiming live acceptance.

- Folder staging retry identity is wired through shared dialog, web/Windows
  transport and Mac bridge. An unchanged retry returns one owner-bound frozen
  proposal; changed intent or expired/reviewed keys fail closed. The dialog
  retains its key across failed preparation. Backward-compatible requests
  without a key remain accepted for older clients.
  51 proposal tests, 61 shared-client/route tests, 18 Mac collaboration tests
  and TypeScript passed. The obsolete database bulk-deletion suite is replaced
  by an explicit retired-command guard; canonical frozen deletion/drift tests
  remain in `write-proposals.test.ts`. Receipts:
  `/tmp/texttext-staging-proposal-final.log`,
  `/tmp/texttext-folder-staging-clients-tests.log`,
  `/tmp/texttext-staging-mac-bridge.log`.
  Real local PostgreSQL acceptance passed: eight concurrent retries commit one
  proposal and one audit, changed intent fails, original intent returns the
  stored review without execution. Regression is included in `npm run test:db`:
  `src/lib/ai/__tests__/proposal-staging.db.test.ts`. Receipt:
  `/tmp/texttext-proposal-staging-postgres.log`; TypeScript passed.
  Frozen source `9b9a218e` passed all 809 core tests in 86 files, TypeScript
  and native sync gates. Exact-source receipts are in the clean candidate at
  `/private/tmp/texttext-candidate-1195-5ELVuo/.texttext/sync/`; log:
  `/tmp/texttext-staging-frozen-9b9a218e-gates.log`.
  Mac 0.204 (1199) built and installed from `9b9a218e`: signed bundle and all
  three extensions validate. Actual startup preserves signed-in account,
  iCloud workspace and existing note; workspace search finds its current path,
  Escape dismisses the palette and returns to the note. Runtime health report
  remains unreadable to the unentitled installer, so UI proof is recorded.
  Logs: `/tmp/texttext-mac1199-build.log`, `/tmp/texttext-mac1199-install.log`.
  Verified archive `texttext-20261008T133807Z-9b9a218e.tar.gz` deployed to
  Oracle; thirteen live checks passed, previous release retained, Algorave and
  shared config unchanged. Receipt: `/tmp/texttext-1199-oracle-deploy.log`.
  The old process again timed out on SIGTERM before replacement; this rollout
  does not close the live drain defect. Local rebuilt production probe passed
  in 6.005 seconds (`/tmp/texttext-1199-production-shutdown.log`).
  Live native staging succeeded against the new Oracle server: proposal
  `2f9f8182-7ec1-4ead-878e-baf1291ee26c`, source `Folder move verified 1198`,
  destination `Folder move verified 1199`, one file/two folders/no access growth.
  Safari approval completed. Active-editor acceptance FAILED: the local TextPack
  remains at the old path while destination has only the empty child; header
  stays old and the editor becomes read-only. Text remains visible, no recovery
  error. Opening the editor before approval may have created a competing local
  checkpoint/outbox, so inspect native pending-path reconciliation before UI-only
  changes. No unsaved text was typed in this check. Preserve the retained file.
  Source trace: `LocalVaultSync.sharedProtection` returns true for a live session
  or pending checkpoint, and the main item loop skips before remote-path
  reconciliation. `VaultEditor` renders read-only when its selected old path
  loses edit capability. A path-only UI patch cannot resolve the retained file.
  Next implement identity-preserving session/file path rebasing in both native
  adapters, keeping token, journal generation, pending update/receipt IDs and
  content; then reconcile the selected editor path without losing draft state.
  Cover clean and pending shared sessions, concurrent direct edits, duplicate
  identity/destination collisions, restart recovery and permission revocation.
  Private app-group sync state is unreadable from the unentitled shell; no
  state files were changed or access protection bypassed during diagnosis.
  Installed-client retry verification remains. PC process 44968 still runs;
  unsaved state has not been established.

- Mac 1197 installs durable native folder-catalog reconciliation. Frozen core
  (795 tests) and native gates passed. Live reviewed move
  `932e1d17-5790-4de2-bcab-08d04496e817` preserved the TextPack hash and empty
  child; the previous tracked folder disappeared automatically. Windows source
  regressions passed, but the new adapter is not installed there yet.
  Live acceptance exposed a shared UI defect: `VaultApp.refresh` replaces the
  listing without reconciling `destinationFolder`, so the selected old folder
  remains and FolderPresentation shows a missing-path error after a move.
  Source follow-up reconciles folder navigation using stable descendant IDs,
  with surviving-parent fallback and no editor replacement. Mac now includes
  cached manifest identities in listings without reading every document.
  Frozen 804-test core and native gates passed. Mac 1198 is installed; live
  folder move preserved bytes/empty child, removed the old tree, followed the
  selected folder and closed the stale dialog without an alert. Oracle deployed
  the shared fix with live checks passing. Windows 121e95fc candidate and
  additional 18 folder tests passed on the PC; installation awaits the running
  older app being saved/closed. Live active-editor acceptance remains pending.
  Oracle stop again hit its 30-second timeout before restart; investigate the
  actual production request drain rather than treating deploy success as proof.
  Legacy read cancellation is deployed in cfa62408 after frozen 804-test and
  native gates. Local production shutdown passed in 6.058 seconds, but an
  explicit restart of the new Oracle process still timed out at 30.197 seconds.
  The fix is insufficient to explain the timeout. All services recovered. Next
  trace live request/connection draining; avoid more blind live restarts.
  The actual Linux package exits idle in 283 ms. An intercepted diagnostic
  request before Next initialization does not install instrumentation, so that
  cold probe is not representative. Warming `/signin` first installs the drain
  and wakes the 25-second diagnostic poll: exit 143 in 6.016 seconds. Evidence:
  `/tmp/texttext-linux-shutdown-warm-probe.log`. Continuous re-poll variant
  also exited in 6.017 seconds. The production verifier now warms a real page
  and explicitly requires installed instrumentation; the packaged Mac probe
  passed in 6.018 seconds (`/tmp/texttext-production-drain-warmed-gate.log`).
  Live timeout remains unresolved; three loopback HTTP connections were active
  during read-only inspection, with no application error in recent logs. Stable staging retry identity and Oracle timeout remain open.
  [Acceptance receipt](2026-10-08-candidate-1195.md).

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
  live folder move is claimed. Queued and active editor moves have native regressions; installed/native
  review and web move acceptance are recorded above. Removed-folder convergence
  and stable staging retries remain before claiming this flow complete.

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
  [Evidence](2026-10-08-remote-folder-move-native.md).

- Mac persisted uploads now adopt path-only remote moves with bounded identity
  indexing, fresh permission and base/lifecycle checks, preserving staged
  attribution and later edits under a new operation identity. All 31 sync tests
  passed, including interrupted adoption, permission restoration and lost ACK.
  Source-only; active editors and live multi-client moves remain pending.
  [Evidence](2026-10-08-remote-folder-move-native.md).

- Persisted Windows uploads now follow path-only remote moves using a fresh
  operation identity, preserving staged and later local edits. Regression first
  reproduced the conflict; 171 portable core assertions passed, including
  interrupted adoption, changed remote content, revoked permission and lost ACK.
  Source-only. Mac persisted-outbox ordering and active editor checks remain next.
  [Evidence](2026-10-08-remote-folder-move-native.md).

- Remote-move verification exposed a Windows path-adoption bug with concurrent
  offline edits. Windows now carries local bytes to the remote path before
  upload and recovers interruption before baseline save. Path-strict Windows
  tests passed 164 assertions; all 27 Mac sync tests passed. The native gate now
  requires the portable Windows core suite, and its fingerprint includes those
  sources/tests. Mandatory native verification passed. This remains source-only;
  persisted-outbox/active-editor orderings and shared folder controls need
  acceptance before shipping. PC still has TextText process 44968 running; do
  not force-close its uninspected editor. [Evidence](2026-10-08-remote-folder-move-native.md).

- Canonical `move_folder_tree` now stages a frozen file/folder/access review and
  executes it through the durable store only after owner approval. Approval saves
  the review hash and access acknowledgement atomically; receipt-only expiry is
  forwarded correctly. Real local PostgreSQL hosted-to-execution acceptance and
  the mandatory core gate passed 772 tests in 81 files plus TypeScript. This is
  source-only; shared folder action UI, frozen release gates and live deployment
  acceptance remain pending. [Evidence](2026-10-08-folder-move-recovery-source.md).

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
  [Evidence](2026-10-08-parent-native-contract.md).

- Frozen candidate `8621dd0c` passed 759 core tests, TypeScript, required native
  suites, 16 proposal-review tests and both Note browser flows. It contains the
  versioned Note parent picker/navigation and preset-generation build guard.
  Oracle is deployed and actual Safari review verified. Mac 1193 is installed
  with actual startup/search/save/reopen verified. Windows passed 299 shared-client
  tests and desktop smoke; installation remains pending. Windows SSH works again,
  but its running editor must close normally before installation.
  [Candidate evidence](2026-10-08-parent-review-cohort.md).

- Canonical `remix_item_type` is committed as `626ee884`, with pinned source
  authorization and durable retries; shipped in 1190. Focused suites passed 56
  tests, with a final 21-test recheck and TypeScript.
  [Receipt](2026-10-08-agent-template-remix.md).
- Shared folder defaults, atomic complete-item creation and reversible template
  retirement are committed in `197c7552`; local/remote CLI parity is covered by
  `eaf1c25e`, `5f74d92a` and `af658589`. These changes shipped in 1190.
  Explicit template choices override defaults; existing items retain their design.
- Candidate source `5254ff85` passed 662 core tests, TypeScript and native
  sync/creation suites. Mac 1190 and Oracle are installed; Windows verification
  is completing on the same source.
  Server/Windows `a0d9391b` and native `163b9a02` remove aggregate folder scan
  limits, cache bounded metadata, and test external change/rename invalidation.
  [Source receipt](2026-10-08-folder-default-retirement-source.md).
- 1191 source `f3167c4b` passed 725 core tests, TypeScript and required native
  checks. It includes custom-field updates, bounded account-profile recovery and
  explicit CLI proposal staging. Clients and Oracle installed; live proposal/field acceptance passed.
  [Receipt](2026-10-08-cli-proposals-live.md).
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
  [Source evidence](2026-10-08-folder-move-recovery-source.md).


- Source `54f33a4e` passed 588 core tests, TypeScript and required native gates.
  Agent template creation and durable template/folder approvals
  now use canonical file operations and retry receipts.
- Shared reader optimizations reduced the bounded 525 KiB note open from
  1.5–1.6 seconds to 170 ms; cached reopen measured 254 ms. Unchanged
  status/presence no longer reparses Markdown. Actual edits still invalidate.
  [Performance evidence](2026-10-07-file-vault-bounded-performance.md).
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
  installed. [Recovery receipt](2026-10-07-recovery-templates-1184.md),
  [shutdown evidence](2026-10-07-read-poll-shutdown.md).
- Standalone CLI `5254ff85` remains installed; real account commands and template
  create/update/retry work while local reads stay offline.
  [CLI receipt](2026-10-07-cli-account-commands.md).
- No web provider is configured; live model execution is not attested.

Keep one canonical file system and shared UI/editor/sync implementation across
Mac, Windows and web. Native adapters handle filesystem, credentials and OS
integration. Legacy data migration is explicitly out of scope; no deletion is
needed to stop using legacy content paths. Home List/Cards already shares items
and actions, with a personal per-device/workspace preference.

## Remaining scope and external limits

- [Agent command inventory](../agent-file-backend.md).
- [Reference-template parity audit](../design/template-reference-parity.md).
- Google client exists but its secret is unavailable; Oracle Google sign-in is
  not configured. Commercial ChatGPT sign-in requires OpenAI registration that
  the owner does not yet have.
- Integrated workspace switching acceptance remains incomplete. Windows live folder-picker
  acceptance is deferred; isolated native checks passed.
- Second physical Apple-device iCloud delivery, Windows provider eviction and
  hardware power loss are not live-certified.
- Required existing `Shoku's Space/My Notes/TextText Changelog.textpack` was not
  found. Do not create a duplicate. Standalone CLI receipt:
  [current CLI](2026-10-07-standalone-cli-current.md).

## Bookmark summary concurrent-edit protection

- Summary editing now retains its starting value, flushes queued reader edits, reads the latest pack, rejects a competing summary change while keeping the draft, and refreshes the displayed document for explicit review. Successful saves preserve unrelated latest fields/body.
- Added focused actual browser scenario to the existing offline native-bridge fixture and `npm run test:bookmark-summary:browser`; the normal npm test pipeline includes it. Focused regression and TypeScript passed, logs `/tmp/texttext-bookmark-conflict-focused.log`, `/tmp/texttext-bookmark-conflict-types.log`. Not built/installed/deployed.
- The unmodified broad fixture stops earlier on stale draft-cache waits and an obsolete hardcoded new-note filename; after temporarily correcting those expectations it stops at another earlier template assertion. Those exploratory corrections were removed; do not claim the full fixture passed. Resolve the broad-fixture assumptions before its next required release gate.

## Oracle shutdown candidate deployed

- Clean source `0533908b` at `/private/tmp/texttext-candidate-1195-5ELVuo` passed all 817 core tests, TypeScript and required native sync gates. Receipts `/tmp/texttext-oracle-drain-core.log`, `/tmp/texttext-oracle-drain-clean-types.log`, `/tmp/texttext-oracle-drain-native.log`.
- Verified artifact: `/private/tmp/texttext-candidate-1195-5ELVuo/.texttext/oracle/texttext-20261008T155231Z-0533908b.tar.gz`, deployment identity `texttext-oracle-20261008T155231Z-0533908b`. Packaging completed; production read drain passed against the actual standalone build: 25-second vault poll woke on SIGTERM, HTTP closed, exit143 in 6007ms without SIGKILL. Logs `/tmp/texttext-oracle-drain-package.log`, `/tmp/texttext-oracle-drain-production.log`.
- Authorized web-only deployment completed with all 13 live checks passing. Live release `/home/ubuntu/texttext/releases/20261008T155415Z-texttext-oracle-20261008T155231Z-0533908b-305b2a`, PID 3674852, active. Previous rollback retained; fresh backup `texttext-20261008T155439Z-9fb8b835.dump`. Log `/tmp/texttext-oracle-drain-deploy.log`. All three Algorave services remained active.
- Shutdown of the previous `da36425d` process 3672086 again exceeded 30 seconds and systemd used SIGKILL. It lacked the assistant drain fix. Do not claim production shutdown fixed: the new source passed isolated production read drain but its own real-traffic shutdown is not yet observed. Avoid an extra blind live restart.
- Oracle preflight: current remains `20261008T144740Z-texttext-oracle-20261008T144520Z-da36425d-d4f6ee`; 15 GB free; TextText plus all three Algorave services active; proxy mtime unchanged October 1; latest backup `texttext-20261008T144805Z-34f4f839.dump`. Recheck before deployment.

## Assistant shutdown drain follow-up

- Cloud assistant generation now receives the existing server lifecycle drain signal as well as request cancellation and its 55-second deadline. Previously an active assistant response could exceed Oracle’s 30-second service stop window even when vault polls drained. This cancels generation, not durable file-store transactions.
- Added route regression: a stalled model stream wakes on drain, closes presence/response and never records a successful partial answer. All 58 assistant route tests and TypeScript passed. Logs `/tmp/texttext-ai-drain-tests.log`, `/tmp/texttext-ai-drain-types.log`.
- Deployed as `texttext-oracle-20261008T155231Z-0533908b`; isolated production read drain passed. This removes a concrete shutdown gap but does not prove the cause of the observed Oracle timeout; new-version shutdown under real traffic remains unverified.

## Live image command acceptance

- Dedicated CLI image-add/remove proposals completed through actual signed-in Safari on Oracle. Mac 1201 rendered the embedded image, then refreshed removal automatically; image bytes remained inside the iCloud TextPack for recovery. [Receipt](2026-10-08-live-agent-image-roundtrip.md). Windows rendering and autonomous model tool selection remain unverified.

## Agent image placement verification

- Approval-to-TextPack regression coverage now includes gallery, cover and body placement. It reads the committed archive through the actual pack reader, verifies exact original image bytes plus the preview, checks placement and retained title/body, and proves completion-receipt replay does not fetch or rewrite the image.
- All 40 write-proposal tests and TypeScript passed. This is automated boundary evidence; live signed-in agent image creation/removal acceptance remains pending.

## Current PC verification and candidate build

- Actual Windows PC full native file/durable sync suite passed against `dbea2f59`, including interrupted move reopening and journal replay/recovery follow-ups. Receipt: `/tmp/texttext-recovery-dbea2f59-pc.log`.
- Full replacement candidate build completed successfully from `dbea2f59`: `C:\Users\Shokunin\dev\texttext-recovery-dbea2f59\windows\build\candidate-d789b71104cb45658a8952900b9c961c`. Native Core/Agent, 326 shared-client tests, TypeScript, publish and actual desktop editor/close/activation smoke passed. Receipts: `windows/build/smoke-receipts-9df746c88eb74967be09f6e7577d6fbb` under that source directory; log `/tmp/texttext-windows-dbea2f59-build.log`. Candidate is verified but not installed.
- Installed PC process 44968 remains running at the standard installed path with an empty window title. Unsaved state is unknown; installation remains pending the already requested save/close. No process was killed or client replaced.

## Interrupted move session reopening

- Regression reproduced Windows reopening against a removed source path after durable move recovery. Session opening now follows only an exact retained move intent matching requested source, item identity and expected projection hash. Missing unrelated paths still fail closed.
- Complete native file/durable sync suite passed on the Mac. Both before-move and after-move interruptions reopen the moved bytes with pending generation and batch identity intact. Logs: `/tmp/texttext-move-reopen-before.log` (reproduction), `/tmp/texttext-move-reopen-final.log` (passed). Not installed yet.

## Latest Windows recovery follow-up

- Shared checkpoint recovery and session-open validation now hold the same file-store mutation lock through materialization, checkpoint inspection and session registration. Collaboration lease acquisition remains outside the file lock. This closes the remaining reopen race with concurrent file mutations.
- Verified on the Mac with `dotnet run --project windows/TextText.Core.Tests/TextText.Core.Tests.csproj`: the complete native file and durable sync regression suite passed, including interrupted materialization, retained journal replay and external edits. This follow-up is not installed yet.

## Working conventions and evidence

- [Sync subsystem contract](../../sync/README.md) and exact-source gates cover
  journals, external edits, epochs, recovery, acknowledgements and sessions.
  Reuse unaffected receipts; verify relevant changes.
- Preserve unrelated edits in `src/components/workspace/assistant/attachments.ts`,
  `src/lib/workspace/__tests__/tabs.test.ts`, the untracked `.probe-editor.ts` scratch file and the
  existing Python cache. Coordinate concurrent edits before staging.
- Local client installs and needed Oracle deployments are authorized. Public
  desktop releases require an explicit request. No automated build/install jobs.
- [Archived implementation history](2026-10-07-handoff-before-shared-templates.md).
