# Native saved-work review, October 17

T07/T17 source slice. This changes the native recovery path, but is not installed or deployed yet. No user folder was adopted during verification.

Mac exposes File > Review saved work and identifies an account-review refusal instead of repeatedly reporting an ordinary connection failure. Windows offers review when preparing a workspace encounters unbound retained state. Both native dialogs show the exact folder and the email from a freshly authenticated account profile. Keep saved work is an explicit choice. Account identity and current workspace permission are checked again after that choice. A changed credential/account, revoked access or cancellation leaves originals unbound.

The renderer must acknowledge its durable barrier before an existing writer retires. Mac collaboration and connection retirement are now awaitable. Windows bridge retirement cancels and drains entered operations and the worker, releases editing leases, rejects later calls and is idempotent. Migration retains the original records through the previously verified native transaction. New account-specific profiles are not copied or reset.

## Evidence

- Full current native gate: `TEXTTEXT_REVIEW_SCREENSHOT=/private/tmp/texttext-t17-mac-account-review-window.png bash scripts/test-sync.sh --native-only`, exit 0; `/private/tmp/texttext-t17-review-ui-native-final.log`. 40 Mac app tests, 116 kit tests with three documented helper/manual skips, 40 agent tests and full Windows core pass.
- The actual Mac production controller and NSAlert sheet pass cancel, account replacement, revoked permission and explicit confirmation with isolated storage and authenticated fixture responses. Matching-profile/current-manifest checks and awaited actor retirement also pass.
- The first Mac UI fixture omitted the required idle durability receipt and correctly reached Keep editing. Correcting only the fixture made confirmation pass. `/private/tmp/texttext-t17-mac-review-diagnose.log` preserves that refusal; the production close guard was unchanged.
- Mac Windows-bridge/identity suite: `dotnet run --project windows/TextText.Windows.Tests/TextText.Windows.Tests.csproj --configuration Release`, exit 0; `/private/tmp/texttext-t17-windows-review-bridge.log`.
- Physical PC WPF/Smoke compile, core and bridge checks pass: `C:\Users\Shokunin\dev\texttext-t17-review-{build,smoke-build,core,bridge}.log`. Existing NU1510 package warning remains; zero build errors.
- Physical PC interactive native smoke exits 0: `C:\Users\Shokunin\dev\texttext-delivery-65417abd\windows\build\account-review-smoke-20261017`. Actual WPF review dialogs pass the same four choices using isolated fixture credentials and an in-process HTTP fixture; no production login or content is touched. Existing renderer-close/activation checks pass as well. Temporary interactive task was unregistered.
- Rendered native screens inspected: `/private/tmp/texttext-t17-windows-account-review.png` and `/private/tmp/texttext-t17-mac-account-review-window.png`. Account, folder, explanation and all three controls are readable. Controls use native system styling; this is not a complete installed dark-mode gate.

## Remaining

Older generic browser drafts and the original WKWebView/WebView2 profiles still need an accessible recovery path. Missing/corrupt legacy state, mixed-version background writers, full cross-process ownership, physical real-account transitions and final coherent delivery remain in T07/T09/T17. These fixture tests do not count as an installed upgrade or the full six-client matrix. Retained original metadata supports forward recovery; older binaries must not write adopted state.
