# Windows close input fence

T07, October 17. Production `MainWindow.RequestClose` previously marked its transition but left the WebView accepting input while awaiting the renderer's final checkpoint. A local edit after the acknowledged barrier but before native release could therefore escape the close decision.

The native close path now disables WebView input before requesting the captured renderer barrier. Script execution and bridge replies remain active. Failure returns through the existing `finally` and restores the same usable editor; successful close keeps input fenced through disposal. This change is limited to final window close. Account transitions and shared session ownership remain open.

## Regression evidence

Added an assertion to the isolated production-window fixture: while its delayed renderer checkpoint is pending, the native WebView must be disabled. Before the change, real Windows desktop smoke failed exactly at `native close fences editor input before awaiting durability`. Log `/private/tmp/texttext-fence-before.log`; remote receipt `C:\Users\Shokunin\dev\texttext-delivery-0a5bbd15\windows\build\smoke-receipts-38499010266c409c9d2923154f75c395`.

After the change, `windows/scripts/smoke.ps1` exited0. Complete native desktop smoke passed: delayed typed receipt, bridge execution while input disabled, normal close, failed flush restores enabled editor, never-settling flush returns an actionable dialog, and activation/close ordering. Receipt `C:\Users\Shokunin\dev\texttext-delivery-0a5bbd15\windows\build\smoke-receipts-2321be30694f493184e449646aa4b3e3`; log `C:\Users\Shokunin\dev\texttext-fence-after.log`. The harness modified only staging source; installed candidate remains unchanged until a fresh full build/seal/install.

Mac regression check `node node_modules/vitest/vitest.mjs run src/local-vault/collaboration-client.test.ts src/local-vault/navigation-flush.test.ts` exited0:101 tests passed. Log `/private/tmp/texttext-fence-mac-client.log`. WPF execution is verified on Windows, not represented as a Mac native result.

Source changes: `windows/TextText.Windows/MainWindow.cs` and `windows/TextText.Smoke/MainWindowCloseTests.cs`. No content format, timeout, or save-success condition changed. Full physical input/close campaign remains part of final acceptance; the fresh installed candidate is verified below.

## Full candidate and installed verification

Source `65417abd` passed full `build.ps1` checks,410 client tests, native publish and desktop smoke `smoke-receipts-594524b812014e58ac5babc9a357bdf2`. Candidate `candidate-b7f4c5a5fa2a49e3b87223746055ae2d` installed after two seal verifications. Rollback `C:\Users\Shokunin\AppData\Local\Programs\TextText-previous-20261017T073108-16bd0db4` retained. Fresh staging root `C:\Users\Shokunin\dev\texttext-delivery-65417abd`; build log `texttext-delivery-65417abd-build-retry.log`. Initial staging omitted the runtime prerequisite and build refused before tests; copied the existing runtime into the script's actual expected path and retried unchanged source. No failed gate was bypassed.

Actual installed fixture `a948425c-4add-47a9-9c73-df83693cc558` accepted its unique native-fence marker via focused keyboard input, confirmed the editor value, closed normally, reopened exact complete content and reconnected for35 seconds. Authenticated hosted `read_item` independently returned the complete body including both Windows markers. Receipts `installed-edit-native-fence-retry.json` and `installed-reconnect-native-fence.json` remain under the earlier staging root's `windows/build`.

The first typing attempt hit the separate screensaver desktop before entering text. A diagnostic observed thread desktop Default, input desktop Screen-saver, foreground0; user settings read `ScreenSaverIsSecure=0`, active1, timeout180 seconds, process `C:\WINDOWS\system32\Flux.scr`. Ordinary synthetic mouse movement was refused (zero events), so no mouse dismissal is claimed. A normal WM_CLOSE request targeted only that known non-locking screensaver's window and succeeded. This follows the ordinary [Windows close request](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-close), without terminating its process forcibly or modifying screensaver/security/power settings. Secure screensavers were explicitly excluded. The retry immediately passed. This explains the intermittent harness input failures; the PC was reachable and its console session active throughout. No owner action was needed, and no persistent wake job was installed.
