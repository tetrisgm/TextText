# Windows close input fence

T07, October 17. Production `MainWindow.RequestClose` previously marked its transition but left the WebView accepting input while awaiting the renderer's final checkpoint. A local edit after the acknowledged barrier but before native release could therefore escape the close decision.

The native close path now disables WebView input before requesting the captured renderer barrier. Script execution and bridge replies remain active. Failure returns through the existing `finally` and restores the same usable editor; successful close keeps input fenced through disposal. This change is limited to final window close. Account transitions and shared session ownership remain open.

## Regression evidence

Added an assertion to the isolated production-window fixture: while its delayed renderer checkpoint is pending, the native WebView must be disabled. Before the change, real Windows desktop smoke failed exactly at `native close fences editor input before awaiting durability`. Log `/private/tmp/texttext-fence-before.log`; remote receipt `C:\Users\Shokunin\dev\texttext-delivery-0a5bbd15\windows\build\smoke-receipts-38499010266c409c9d2923154f75c395`.

After the change, `windows/scripts/smoke.ps1` exited0. Complete native desktop smoke passed: delayed typed receipt, bridge execution while input disabled, normal close, failed flush restores enabled editor, never-settling flush returns an actionable dialog, and activation/close ordering. Receipt `C:\Users\Shokunin\dev\texttext-delivery-0a5bbd15\windows\build\smoke-receipts-2321be30694f493184e449646aa4b3e3`; log `C:\Users\Shokunin\dev\texttext-fence-after.log`. The harness modified only staging source; installed candidate remains unchanged until a fresh full build/seal/install.

Mac regression check `node node_modules/vitest/vitest.mjs run src/local-vault/collaboration-client.test.ts src/local-vault/navigation-flush.test.ts` exited0:101 tests passed. Log `/private/tmp/texttext-fence-mac-client.log`. WPF execution is verified on Windows, not represented as a Mac native result.

Source changes: `windows/TextText.Windows/MainWindow.cs` and `windows/TextText.Smoke/MainWindowCloseTests.cs`. No content format, timeout, or save-success condition changed. Full physical input/close campaign remains part of final acceptance; the new source fix is not yet installed.
