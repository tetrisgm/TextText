# TextText handoff

## Current delivery

Pending-epoch recovery core is committed as `451b8325`, with real-store restart,
lost-ACK and late-edit tests. Native adoption is committed as `7ab6cbca`;
[native verification](verification/2026-10-09-native-epoch-adoption.md).
Live editor rebinding is unfinished. The independent review found an adopted
journal crash window that falsely enters recovery and an old-document lifetime
leak; fix these before delivery. Resume evidence and scopes:
`/tmp/texttext-epoch-resume-after-limit.md`, `/tmp/texttext-epoch-core-review.md`.
Fable resumed October 9 at 02:50 Pacific: separate core and editor workers own
the remaining integration. The saved epoch-adoption helper has isolated tests
and TypeScript passing, but is not integrated or shipped.

Installed: Mac 0.204 (1239, source `85c9bcab`), Windows source `488746b2`,
Oracle `6d07ca4b`. Mac physical rename/focus/undo now passes; the old full1237
fixture still shows pending recovery, contradicting the clean-journal diagnosis.
Windows 85c9bcab candidate is built but its existing app refused normal close.
[Installed evidence](verification/2026-10-09-mac-1239.md).
The reported three baseline collaboration failures did not reproduce: all 70
`collaboration-client.test.ts` cases pass in a clean `033b1824` archive. The
earlier failure claim is withdrawn; `/tmp/texttext-epoch-baseline-audit.md`
records the isolated command and evidence. Pending-epoch recovery is in progress.

Rename focus loss (Mac 1238 physical evidence) is fixed in source: the listing
row for a freshly renamed path lacks its manifest identity, the open path left
the listing, and the editor flipped read-only and unmounted. The editor now
keeps its element, caret and undo through stale and identified listings and
still loses editing on explicit revocation; browser regression fails on the old
source and passes now. Build, install and physical rename re-check remain.
[Receipt](verification/2026-10-09-rename-focus-continuity.md).

Mac 1237, Windows and Oracle had the projection-baseline repair. A fresh
six-client preflight reproduced Mac editor recovery after a filesystem rename;
timed input was aborted. [Current failure](verification/2026-10-09-rename-editor-failure.md).
Windows superseded-upload recovery is committed and building;
[receipt](verification/2026-10-09-superseded-upload.md).

Latest six-client attempt failed: Windows stayed local and raised an external
file conflict while other clients continued. Its pending edits remain protected.
[Failure, test limitations and next investigation](verification/2026-10-08-six-client-full1235.md).
Mac 0.204 (1236) and Windows source `248bbb28` are installed. Mac existing-note
search, edit and saved-file verification passed. Windows recovered all six retained
PC markers and its CLI marker to disk, then closed with a successful native flush.
It still could not join shared editing: the upload conflicts while reconciling
sequential JSON/Markdown edits against the last cloud base. The representation-baseline repair now passes shared/native tests and focused
review; build and deploy next. Six-client acceptance is not passed.
[Repair receipt](verification/2026-10-09-projection-baseline.md).
[Current installation and failure evidence](verification/2026-10-08-client-1236.md).
[Multiple-edit merge repair](verification/2026-10-08-multispan-recovery.md).
The owner requested less custom sync machinery. A bounded standard-provider
prototype is in `scripts/experiments/hocuspocus`; production replacement is not yet
implemented or verified.
The isolated crash probe now passes SIGKILL after ACK, commit-before-ACK replay,
and existing-writer revocation. Its negative control proves default debounced
storage alone is insufficient. The y-indexeddb browser probe also passes two
Chromium process-crash/replay checks after an explicit disk barrier. See the
experiment README for limits and commands; neither adapter is in production.
Oracle now serves `texttext-oracle-20261009T045727Z-6b940d3e`, including concurrent
file appends and template sidecar changes that preserve the current Yjs epoch;
[regression and delivery limits](verification/2026-10-08-template-continuity.md).
Epoch recovery work now retains the authoritative binary state before resets and
prepares a deduplicated merge through the authorized durable server writer.
Client journal/native lease adoption is still pending;
[scope and remaining integration](verification/2026-10-08-epoch-recovery.md).

## Active sync repair

External-file changes now reconcile through the existing Yjs checkpoint drain,
retaining the editor, native lease and undo identities. Mac native CAS rejection
also keeps the lease alive and prevents a second background import while editing.
Source `176228d3` is installed as Mac 0.204 (1233). Full gates passed, including
851 shared tests, TypeScript, browser continuity/undo and native suites.
Actual Mac typing plus three CLI replacements preserved all markers; native
undo/redo kept CLI edits, and Finish saved normally. PC isolated production-window
tests also passed app/CLI collisions with continuous editor-element observation.
[Evidence and limits](verification/2026-10-08-inplace-file-merge.md).

Next: restart with pending edits plus external changes, multiple importers,
overlapping replacements/template-source changes, and all six physical clients.
No six-client pass. Startup location restoration caused a reproduced activation
race; source 3319d821 fixes it and a physical PC retest stayed on the right file.
That retest then reproduced the pending-session recovery banner before editing.
See the restart delivery receipt; pending edits remain preserved.
Canonical PC app remains stopped; preserve/reconcile the earlier retained test
journal before reopening. Isolated acceptance apps closed normally.

## Additional interruption triggers

Attachment changes now preserve Yjs identities rather than resetting the epoch;
source b36da30a passed 854 shared tests, TypeScript and all browser modes. The
failed PC fixture also contains a native CLI retry receipt added after its base.
Server inspection confirms epoch 2 versus the PC's epoch 1. Current candidate
keeps valid newly added CLI receipts inside the same session, with a reproduced
failing baseline and passing regression. Both server fixes deployed as
`texttext-oracle-20261009T042315Z-f4b8472f`; authenticated live checks passed;
the old pending journal still requires reconciliation.
[Evidence](verification/2026-10-08-attachment-continuity.md).

## Pending restart candidate

Current source now keeps a valid pending native checkpoint after a same-ID file
changes while closed. Native open returns its projection hash; the shared editor
reconciles that exact journal against the current file and any newer browser
journal before permitting a native checkpoint. Conflicting edits do not overwrite
the file. Windows core tests and desktop compilation pass; Mac's new restart test
passes among 19 shared-editing tests. Full native and core gates passed with exact-source receipts: 853 shared
tests, TypeScript, both browser modes and native suites. A serial core rerun
resolved receipt invalidation from concurrent Package.resolved regeneration.
Logs `/tmp/texttext-restart-{native,windows,windows-build,core-stable}.log`.
Installed as Mac 1234 and Windows source 88e9ad0e; physical restart acceptance is not yet passed. Older retired journals, overlapping
replacements and six-client acceptance remain outstanding.

## Earlier delivery references

- Mac `/Applications/TextText.app`: **0.204 (1234)**, source `88e9ad0e`.
  Latest install and native app/CLI acceptance: [receipt](verification/2026-10-08-inplace-file-merge.md).
  Signed-in startup and existing saved note/body passed on the real iCloud root.
  Actual Safari share now writes a bookmark into `Bookmarks`, native Command K
  finds it immediately, and the same item/title/original URL opens on Oracle.
  Two roots fixed: startup skipped the share watcher when a file workspace was
  open; filing still used the legacy server writer. Share note/bookmark/draft
  now use the durable CLI creation journal and normal file synchronization.
  File share creation now preserves complete attachment bytes; current reader
  acceptance found a Gallery content-kind mismatch (see immediate work).
  Current source also supports append by stable item identity with a mutation
  receipt inside the TextPack; three focused tests pass, including retry after
  later human edits and rename. Build/install and signed-in startup passed;
  existing capture reopens with its saved title and URL. Exact-source sync gate
  passed (848 shared tests plus native suites), `/tmp/texttext-dbab6d3a-sync.log`.
  Finder Quick Look now renders an existing note's saved title and body after
  fixing the missing `QLPreviewingController` conformance. Nine focused preview
  tests and the required exact-source sync gate pass. Build 1226 installed and
  reopened signed in with the saved bookmark and URL intact.
  [Quick Look receipt](verification/2026-10-08-quicklook-delivery.md).
  File Provider interactive checks remain.
  [Share delivery](verification/2026-10-08-share-workspace-delivery.md).
  [Current acceptance](verification/2026-10-08-current-client-acceptance.md).
- Oracle: **texttext-oracle-20261009T023037Z-9189ee96**, deployed successfully;
  thirteen live checks passed. TextText and all three Algorave services remain active; HAProxy unchanged and
  previous release retained. Safari reopened the saved photo and reconnected. Live Safari automatic PDF capture displayed “Dummy PDF file”
  without reload; independent iCloud TextPack inspection confirmed persisted content.
  [PDF delivery](verification/2026-10-08-pdf-capture.md).
- Windows installed source **88e9ad0e**, candidate verified and replaced the
  canonical app. Native core/agent suites, shared client tests, TypeScript,
  packaging and interactive WPF smoke passed. Previous app retained at
  `C:\Users\Shokunin\AppData\Local\Programs\TextText-previous-20261008T205348-6c5abe98`.
  Canonical app remains stopped during acceptance. The real pending fixture A
  journal is preserved, including a fresh copy under
  `C:\Users\Shokunin\dev\texttext-live-restart-88e9ad0e\before-native-state`.
  The restart acceptance attempt stayed on Home before editing; not a sync pass.
  Diagnostic runner source `98e67022` exposed an empty activation queue on Home.
  Browser reproduction identified late startup location restoration overwriting
  an already activated file. Current candidate fences that restoration; new
  `--early-open` regression fails baseline and passes the fix. Full core gate
  passed: 853 tests, TypeScript and all three browser modes. Navigation fix
  passed isolated physical activation, but the pending fixture still shows recovery.
  Canonical delivery and successful pending restart acceptance remain outstanding.
  A separate 1232d runner returned exit 0 (12 inputs, editor continuity); its
  individual receipts still need collection. New PC SSH connections reset on
  both existing profiles, so its CLI actor never started.
  [Current delivery and open failure](verification/2026-10-08-restart-delivery.md).
- Real workspace: `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`,
  ID `be28ae03-c64e-4695-80af-04f048f86f37`. Preserve content.

## Current candidate / immediate work

- Six-client setup now has a real Windows production-window/cloud runner and a
  direct atomic TextPack actor. Focused run d preserved all seven markers, but
  measured a 1,195 ms editor gap during file import. Pending edits are still
  explicitly retired on external-file change in the shared client. Fix that
  reconciliation/typing-continuity path before claiming simultaneous acceptance.
  Run c's interrupted test-only journal is retained; do not clear it to hide the
  failure. Canonical PC app needs reopening after temporary SSH service-accept
  resets clear. [Exact evidence and retained state](verification/2026-10-08-live-windows-file-collision.md).

- External-file collaboration promotion: the UI only promoted app-created notes
  after initial upload. CLI-created/repaired files could remain in local editing
  until reopened. Current fix applies the same durable flush/identity/hash checks
  to every local editor. Browser regression covers app creation and external-file
  opening, local typing before sync, and later external edits in both arrival
  orders. These checks now belong to the required core sync gate. Candidate is
  `2e0e10c1` passed the core gate (848 tests plus both browser modes). Mac build
  1232 installed and passed signed-in startup, CLI creation/search, live reader
  updates, and native typing reflected in Safari without Save. Windows installed
  the same source; independent file inspection confirms identity and both markers.
  Logs `/tmp/texttext-mac1232-{build,install}.log` and
  `%TEMP%\texttext-windows-2e0e10c1-build.log`. Windows visible editor remains unverified.
  Full web verification passed after updating the exact bootstrap request count
  and testing a valid recovered draft during denied access/failed saving. Oracle
  deployed `9189ee96`, thirteen live checks passed; all unrelated services active.
  See `verification/2026-10-08-external-file-promotion.md`.

- Share attachments: installed 1229 (`95dace27`) passed signed-in startup,
  search, and actual Finder photo creation. The complete image TextPack arrived
  in the Windows folder, but the Mac reader rejected `kind: gallery`. The
  template is `texttext.gallery`; the shared content kind must be `media_post`.
  Fix `f1ba5ec4` maps this in common CLI creation, retaining the Gallery template.
  Five focused share tests and the full exact-source gate passed. Build 1230
  installed and reopened signed in; the repaired photo visibly renders. Fresh
  Finder capture 1231 also opens normally in Mac and Safari, and the PC stores
  the identical original image hash. Other file types/multiple files remain.
  Logs `/tmp/texttext-share-kind-tests.log`, `/tmp/texttext-mac1230-build.log`.
  Fixture retained: `Gallery/Finder photo share 1229.textpack`, original image
  SHA-256 `ed06a94f6b494148666ddcc13727aa3912aa8b750dab26da7d3f50fa620c6baf`.
  Before restart, repairing the fixture directly did not clear the open reader
  error. Fix `c0d37699` reloads errored readers on file changes, preserves healthy
  editors and cancels stale recovery on navigation. TypeScript and the reader
  browser suite and exact-source gate pass. Build 1231 installed; actual native
  reproduction recovered automatically after atomic file repair, without reload
  or reopening. Windows installed the same UI source. Oracle deployed `ee7292ad` after the complete web-only gate; all thirteen live
  checks passed. Logs `/tmp/texttext-reader-recovery-web-verify.log` and
  `/tmp/texttext-reader-recovery-oracle-deploy.log`.
  [Recovery and live sync evidence](verification/2026-10-08-reader-recovery-live-sync.md).
  Original fixture retained at `/tmp/texttext-photo1229-before-kind-fix.textpack`.
  Supersedes intermediate 1227/1228 candidates; neither was installed.

- Owner now explicitly requires **all six simultaneously**: Mac CLI, Windows CLI,
  both native desktop apps and a browser on each physical machine. The acceptance
  matrix and remaining real-adapter orchestration are in
  [six-client acceptance](verification/six-client-sync-acceptance.md).
  The extended local two-account collaboration run passed twelve alternating
  small edits (median 448 ms, p95/max 522 ms), concurrent/undo/redo, offline/reload,
  permission revocation, file/folder visibility and zero idle repeat mutations.
  Log `/tmp/texttext-six-preflight-latency.log`. This is not a six-client pass.

- Owner's latest acceptance priority: independently measure complete file/asset
  replication, direct CLI edits appearing in open clients, and realtime typing
  across users. Require preserved concurrent edits, automatic reconnection,
  durable restart recovery and bounded idle work. Existing receipts establish
  particular convergence/restart cases, not current cross-platform latency or
  every failure mode. Keep those distinctions explicit.

- Shared Notes backlink cancellation is delivered on Oracle and Mac.
  Exact-source full sync gate passed for e722c893. Oracle deployed and passed
  live checks; Mac 1222 installed and reopened signed in on the real iCloud
  workspace with existing note/body intact and no recovery controls. Windows
  now uses ab8d2968, including backlink cancellation.
  [Delivery receipt](verification/2026-10-08-backlinks-delivery.md).
  Closed/unmounted scans stop after their current batch; old results/errors
  cannot overwrite a reopened panel. Baseline fails the new regression; current
  source, TypeScript and reader rerender checks pass.
  [Receipt](verification/2026-10-08-backlinks-cancellation.md).

- Live automatic PDF capture saved correct content but left the open reader
  pending until reload. Current source adds targeted reader invalidation after
  background capture, preserving unsaved drafts. TypeScript and five related
  unit tests and the full browser fixture pass. Oracle deployed and fresh Safari
  acceptance passed. Mac 1221 built, installed and passed signed-in startup,
  existing note and cross-client captured PDF read. Log `/tmp/texttext-mac1221-build.log`.
  Physical Windows candidate verified and installed; current visible acceptance pending.
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

- Verify Windows false recovery after the authorized candidate install. The reported 1185 note has zero pending updates but an old retired
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
