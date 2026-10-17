# Completion execution: October 17

## T01: source and installed baseline

Source: `175a9fb6` on main; pull reported already up to date. The five unrelated dirty paths listed in HANDOFF are unchanged and excluded from candidates. No running TextText/build/test process was found on the Mac; Windows had Codex-owned Node processes, which were left alone. No active TextText/dotnet build process was observed on Windows.

| Surface | Observed identity | Interpretation |
| --- | --- | --- |
| Mac installed | `/Applications/TextText.app`, 0.204 build 1260; Apple Development signature, team 52WM463HR2 | Historical local close fix; latest browser fix not installed |
| Windows installed | Verification created 2026-10-12T06:40:26.476Z; source `cedbc88fd61d51c7366bdc42346c7af7b94d96024d7a2a563ba28de553b4f680`; all seven build checks present | Matches historical candidate fingerprint; latest browser fix not installed |
| Oracle | `texttext-oracle-20261011T180600Z-136bc176`, commit `136bc1761f1bdfb49b6798d3ddd7e4b8413cd7f0`; service active since October 11 | Older than both local candidates |
| New build input | Pristine `git archive 175a9fb6`, Windows source fingerprint `5ecd94af3bd2b09e2a61bed952f11c1a084009698b846e30d773caacc04ccfca` | Excludes unrelated edits; includes `e61d2622` |

Oracle backups include daily dumps October 13–17; newest observed `texttext-20261017T042446Z-9b3abecf.dump`. Presence is not restore validation; deployment preflight still must validate backup. Installed Mac `LocalVault/app.js` SHA-256: `fe9623dab6b0e32c9fc4dd9ee0518ad623dd76f417ecaa0fe5bb898855b4a4f9`. Historical Mac build archive and six-client temporary directory no longer exist. Their durable summaries remain references, not fresh physical attestations. Browser/private-actor identities must be collected when their current builds run; no current six-client pass is claimed.

## T02: persistence observation

Existing direct `pc` SSH authenticated and ran hostname successfully. Windows last boot: `2026-10-13T19:41:28.7987090-07:00`. The existing machine policy still contains `--disable-features=AutofillAiWalletPrivatePasses`, and sshd is Running/Automatic. Since October 12, Security 4625/4740 count was zero. OpenSSH/Admin had two connection-aborted key-exchange events, a different signature from account token/lockout failures. No SSH or policy change was made.

This demonstrates policy retention through an intervening real reboot and a multi-night observation window with no logged account failures. It does not prove fresh WebView2 environment application on the current runtime; repeat launch-triggered checks during the Windows candidate build/smoke before closing T02. No reboot was initiated.

## T03: delivery in progress

Building Mac local Store shape 0.204 build 1261 from the pristine snapshot, using local PostgreSQL and the existing signed Codex helper/profiles. Log: `/private/tmp/texttext-finish-mac-1261.log`. No install/deploy is claimed yet. Next: inspect build result; preserve any required-check failures before changing source.

## T23 authorization

The owner explicitly answered “any. make your own” to the request for a second test account on October 17. Creating a dedicated TextText test account is authorized for this gate; no permission bypass is authorized. Use normal sign-in and disposable fixtures.

### Mac delivery and new-note verification

`APP_VERSION=0.204 APP_BUILD_NUMBER=1261 TEXTTEXT_STORE_LOCAL=1 TEXTTEXT_EMBEDDED_CODEX_RUNTIME=/Users/shokunin/.local/bin/codex node scripts/with-local-database.mjs bash mac/scripts/build-store.sh` completed with exit 0. The exact-source core gate passed 919 tests; native regression gate passed. Xcode 27 printed CoreDevice/CoreSimulator mismatch diagnostics and two “command failed with exit code 0” messages; the overall build nevertheless completed and signature/architecture verification passed for the app and all three extensions. These diagnostics are retained in the build log, not represented as a clean warning-free build.

`install-local.sh` completed with exit 0 using the established local-development runtime-health exception (the Store-shaped local bundle lacks release attestation). `/Applications/TextText.app` now reports 0.204 build 1261, one canonical process. Overall runtime health remains unverified. Installed and built `LocalVault/app.js` SHA-256 both equal `045fe96fe095b33d295c99cc1f548607242369acc294b1836c532dd53bc91a93`.

Through the installed File → New note menu and actual keyboard input into accessibility-located Title/Document body controls, created fixture item `4d8c5644-2cfa-4df1-a050-7baeb4e98441`, `Notes/3.textpack`, titled `Six-client acceptance installed Mac 1261`, body `Installed Mac 1261 new-note save and reopen verification.`. An independent `texttext read` verified those bytes after normal application quit; no TextText process remained. Relaunch restored the same visible title/body without a recovery message. Background startup initially deferred shared editing until the window became active; activating it completed the open. Accessibility value assignment did not enter text; actual focused keystrokes did. No failed input attempt is counted as a save.

Current T04 limits: ordinary new-item save/quit/reopen is verified on Mac; installed offline/reconnect and remaining cross-platform cases are still open. The first two menu-created blank fixtures were left intact rather than deleting uncertain files. Window screenshots/sampling logs remain private in `/private/tmp`, not committed.

### Windows delivery

The first remote build wrapper failed because outer PowerShell `ErrorActionPreference=Stop` promoted a native npm deprecation warning into `NativeCommandError`. No app was installed from that attempt. Rerunning the same `build.ps1` through cmd.exe output redirection passed locked dependencies, native/core/agent tests, 407 client tests, TypeScript, UI, desktop publish and real desktop smoke.

Source fingerprint: `5ecd94af3bd2b09e2a61bed952f11c1a084009698b846e30d773caacc04ccfca`. Sealed candidate `candidate-f4394b42d0014eb9b9b54f191fe2dd1d`; smoke receipts `C:\Users\Shokunin\dev\texttext-finish-175a9fb6\windows\build\smoke-receipts-ac6c50bf82a443ff9ebe6ba8b174af5a`. `install.ps1 -Candidate <that absolute directory>` verified source/artifacts twice and installed successfully. Rollback: `C:\Users\Shokunin\AppData\Local\Programs\TextText-previous-20261017T033819-7874fc8d`.

Actual installed executable UI verification is running separately; no new-item Windows pass is claimed yet.

### Oracle verification in progress

Running the web-only `ship.sh` workflow from the same product source with documentation updated to `0884bd4f`. The build archive uses explicit `GIT_DIR`, `GIT_WORK_TREE` and a private copied index for read-only source identity queries, excluding unrelated checkout modifications; no development worktree was created. Required tests use local PostgreSQL. Log `/private/tmp/texttext-finish-web-0884bd4f.log`; deployment is not yet claimed.

### T04 Windows installed edit/close/reopen

Used Windows UI Automation in bounded one-shot interactive tasks to drive the actual installed `TextText.exe`, with executable path/PID and foreground checks. Created a new note via its real New note button; typed title `Six-client acceptance installed Windows 175a9fb6` and body `Installed Windows new-note save and reopen verification.`; normal `CloseMainWindow()` completed and the process exited. The first typing probe found no control before activation settled and entered no text; a bounded readiness wait corrected the probe.

An independent ZIP entry read verified fixture `Notes/Untitled 17.textpack`, item `a948425c-4add-47a9-9c73-df83693cc558`; semantic title/body matched. The Mac CLI independently found the same content, proving cross-device delivery for this fixture. Restarting the installed Windows executable with that file argument displayed both exact strings, showed no recovery notice, and closed normally. The archive remained byte-identical across reopen: `05dc0c28d3162deb7d40f88b11f40cd77e0f579ad812e40dc101ff09c8a758d1`. ZIP container equality here demonstrates an unchanged reopen, not general semantic convergence.

Receipts under `C:\Users\Shokunin\dev\texttext-finish-175a9fb6\windows\build`: `installed-probe.json`, `installed-create-probe.json`, `installed-edit-close.json`, `installed-file-read.json`, `installed-reopen.json`. One-shot tasks were unregistered after completion. Fixture and failed-probe logs remain; no user files were removed.

The existing TextText changelog was updated through its CLI with a fresh hash and whole-body write. The October 17 local-install entry occurs once; removing that insertion from the reread reproduces the complete prior markdown exactly.

### T02 fresh-environment replay complete

Two further complete native desktop smoke runs passed: `smoke-receipts-cfa484163e744b27a2fdc3bc5f5b31cc` and `smoke-receipts-98c40ccf1f784348a29e0c3e9975bac7`, under the same Windows build root. Together with the build's smoke, these repeat the prior 18-environment trigger campaign. Security 4625/4740 since the build period remained zero; policy unchanged and SSH access still worked. Combined with the October 13 boot and multi-night event window, T02's persistence/reproduction checks pass. This remains a workaround for the identified runtime fault, not a claim that every future SSH failure is prevented.

### Oracle deployment blocked before switching

The first packaging attempt failed because Turbopack rejects a node_modules symlink outside the build archive. Preserving that link and making a private APFS-cloned dependency directory fixed the build. The retry reused passed web/database gates with the supported `--skip-tests` option: 4,952 main tests passed (155 skipped), 118 database tests, 4 scale tests, exact-source sync core/native checks, TypeScript and Oracle packaging/preflight tests passed. The skipped cases are not physical acceptance evidence.

Verified archive: `/private/tmp/texttext-finish-175a9fb6/.texttext/oracle/texttext-20261017T105000Z-0884bd4f.tar.gz`. Incoming/unpacked candidate: `20261017T105126Z-texttext-oracle-20261017T105000Z-0884bd4f-5b7f0f`. The backup preflight refused available storage below its 5 GiB archive reserve plus 2 GiB floor. No current symlink switch or production migration occurred; existing release remains active. Observed free space 6.4 GiB; backups 2 MiB, releases 20 GiB, incoming 6.7 GiB.

Pending owner approval: delete only 11 redundant `incoming/20261008*/release.tar.gz` files, total 3,503,692,227 bytes. Each has its unpacked release still present. Preserve every backup, installed release, current release, and October 17 candidate. Do not delete or lower the backup reserve while approval is pending.

### T06 native conformance additions

Added real filesystem permission denial on Mac: failed checkpoint leaves prior checkpoint bytes/generation and projection intact; after permissions are restored, retry and a fresh store read recover generation 2 and pending text. Focused Swift test executed **one** matching test and passed; supplementary XCTest bundles reported zero selected tests and are not counted.

Added production Windows store checks: cancelled checkpoint writes no intent/projection or upload; a read-sharing lock rejects checkpoint replacement without acknowledging the newer generation; pending intent survives; a new store replays it after the lock is released. Portable core suite on Mac passed cancellation assertions and the existing suite. Native Windows core suite passed all six new assertions and the existing suite. The first Windows test archive included generated AppleDouble metadata; those files were preserved outside compiler inputs. A second harness run lacked the shared workspace-binding fixture; supplying the existing fixture corrected it. No product code was changed to address either harness failure.

Logs: `/private/tmp/texttext-t06-mac.log`, `/private/tmp/texttext-t06-portable-core.log`, and `C:\Users\Shokunin\dev\texttext-conformance-t06-core-fixtures.log`. Full cross-adapter fixtures, ENOSPC failpoints and all crash boundaries remain open.

### T23 account ready

A dedicated second TextText account was created and authenticated through normal production email sign-in, using a test-only plus-address of the existing MXroute mailbox. No authentication bypass or developer login was used. Its isolated browser profile remains private under `/private/tmp/texttext-acceptance-browser-20261017`; session/link/SMTP credentials were not logged or committed. Permission tests remain to run.

### T05 controlled activation coverage

Extended the isolated production MainWindow smoke to assert that the same file can be activated after the prior request completes, and that activating after navigation away opens the requested file again. Existing duplicate-pending, busy retry and close-during-activation assertions remain. Fresh smoke passed all cases: `C:\Users\Shokunin\dev\texttext-conformance-t06\windows\build\smoke-receipts-d506f5c07bc543278e8389c51fe882f9`.

The initial standalone smoke failed before these assertions because its new source directory lacked the production Assets bundle. Running the existing `windows/scripts/build-ui.mjs` prerequisite corrected the harness; no production behavior was weakened. The historical run174 trace still exists on Windows and was reread for event keys/order. It lacks the original failing activation/checkpoint receipt, so that exact historical refusal cannot be reconstructed. The audit retains this bounded gap; current controlled-order passes do not retroactively explain it.

### T23 real two-account permission checks

Owner used the installed Mac sharing dialog on disposable item `4d8c5644-2cfa-4df1-a050-7baeb4e98441`. The second account's real authenticated Chromium profile opened the viewer-granted document; content edits and share management returned 403, and the other private fixture returned 404. Owner changed its item grant to editor; the second account typed `[second-account edit 20261017]` in the actual deployed editor. Server ZIP read and independent Mac CLI read verified original text plus exactly one marker.

The second account then went offline, accepted `[offline revoked edit 20261017]`, and retained pending work in its browser journal. Owner revoked access using the installed sharing dialog and its confirmation. Reconnect denied private reads, retained pending work, and an independent owner CLI read showed zero revoked-offline markers in shared content. Re-granting viewer access restored scoped reads, still denied writes, preserved the recovery journal across browser restart, and did not upload the revoked pending edit.

These checks ran against the still-active October 11 hosted bundle, not the blocked new Oracle candidate. They establish real account/grant behavior and preserved offline intent for that bundle. Current-source physical repetition, CLI/MCP identity, account switching within one browser profile, native account transitions and final audit/presence checks remain open. Private result summaries and profile are under `/private/tmp/texttext-two-account-*` and `texttext-acceptance-browser-20261017`. Test grant is currently viewer; original owner retains access. No private user document was shared.

### T07 source fix

Two deterministic failures are now fixed and protected: close chasing later remote checkpoints, and a retired lifecycle returning durable after delayed persistence. New local input during the wait still extends the barrier. Focused tests 101/101, client gate 410/410 with TypeScript, and real browser epoch-adoption/persistence check passed. See [captured barrier receipt](2026-10-17-captured-local-barrier.md). This new source change has not been delivered to any installed/hosted artifact.

### Latest candidate preparation and archive fixture correction

Preparing Mac 0.204 build 1262 from product source `4759137e`, which includes the captured barrier and production Mac close/quit guards. One initial command ran the check stage from the working checkout; its six owned processes were stopped before packaging and the build restarted from the pristine archive. Unrelated Package.resolved content remains `ecef5ee26c5bc34cddc75ad2aa80b7394857c591`.

The pristine candidate's required native gate then exposed `LocalVaultSyncTests.testOpenEditorPreservesBothAssetsWhenSameEntryChangedOnTwoDevices`: expected and actual archives were both 1,983 bytes but differed. The test manufactured a fresh remote ZIP separately for transport, conflict response and expected comparison. `withAsset` creates a new source file each time, so ZIP entry metadata can differ. The fixture now captures the actual supplied remote archive once and compares retained bytes against that exact input. Asset-byte and queue/conflict-state assertions remain unchanged; no production conflict handling was weakened.

`node scripts/with-local-database.mjs node sync/verify.mjs --native-only` passed after the correction, including all required native suites and portable Windows core checks. This verification used the main checkout's native sources; unrelated JS edits are not native compilation inputs, and the gate preserved Package.resolved. Its working-checkout fingerprint receipt will not be reused as candidate attestation. Log `/private/tmp/texttext-native-fixture-fixed.log`. The failed candidate log `/private/tmp/texttext-finish-mac-1262-pristine.log` remains preserved; build 1262 is not installed yet.
