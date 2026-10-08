# Current Windows Gallery candidate

Source `73740adb`, including the shared detailed-photo input and single-photo asset metadata editor now installed on Mac and Oracle. Actual PC build passed native Core/Agent regressions, 327 shared-client tests, TypeScript, self-contained WPF packaging and desktop editor/close/file-activation smoke. Source receipt sealed.

Candidate: `C:\Users\Shokunin\dev\texttext-client-73740adb\windows\build\candidate-be3fe0f00969437f923b4c4ab51a77f6`.
Smoke receipts: `C:\Users\Shokunin\dev\texttext-client-73740adb\windows\build\smoke-receipts-6d9dd37fe22744438a1a7f1104eb2c42`.
Log: `/tmp/texttext-windows-73740adb-build.log`.

Not installed: the older TextText process is still running and its unsaved state is unknown. Owner has a pending save-and-close request. No force termination, user-content changes or persistent build jobs were used. No installed visual/model/live-sync acceptance is implied.
