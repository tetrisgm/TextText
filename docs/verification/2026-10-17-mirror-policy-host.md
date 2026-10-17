# Portable mirror policy host

T11 foundation and first engine slice, following `5d2da4b6`. The known-item disposition now runs through the packaged policy in both native engines. Installed artifacts are unchanged.

## Contract

The existing local UI build now packages one pure TypeScript mirror disposition function and an RPC host. The first slice covers a known live item after path and binary reconciliation: changed local bytes require an upload with the native CAS precondition; otherwise changed remote revision or refresh requires a pull; otherwise idle. Missing files/items, deletion, permission, conflict and active-editor decisions remain outside this slice.

`mirror-policy.json` and the handshake contain a version and SHA-256 digest of the three policy source inputs. Each page has a fresh runtime identity. A compare-and-swap binding generation permits a deliberate account/workspace connection change without reloading the page. Native adapters freeze the acquired generation. Stale binding attempts and decisions from the old connection are rejected. Requests and replies carry account, workspace, lifecycle, request identity and exact captured observations. No credentials or filesystem paths enter the policy.

Swift and C# contain RPC validation, not another disposition algorithm. They validate the reply and recheck page identity after evaluation. Timeout is bounded to five seconds and retires the adapter; cancellation and retirement cannot turn a late reply into write authority. The Mac actor cancels its pending continuations on retirement. Existing native workspace locks, file CAS and durable queues will remain required when the first engine branch is connected.

## Verification

All final commands exited 0:

- `npx vitest run src/local-vault/mirror-policy-host.test.ts`: four tests, including all eight serialized decision vectors, malformed observations, wrong identity, retired page and binding-generation replacement.
- `TEXTTEXT_MIRROR_POLICY_BUNDLE=/private/tmp/texttext-t11-policy-fixture node src/local-vault/__tests__/mirror-policy.browser.mjs`: exact packaged script, all vectors without an editor, offline execution, digest identity and reload rejection. Log `/private/tmp/texttext-t11-policy-browser-final.log`.
- `bash scripts/test-sync.sh --native-only` with the explicit policy, composition, owner and legacy-viewer fixtures: 45 app tests, 121 Kit tests (four explicit volume/process skips), 40 CLI tests and the complete portable Windows core suite. The policy uses the production `LocalVaultWindowController`, packaged home page, normal close guard and retained closed-window page; all vectors, forged replies, account/workspace replacement, reload rejection and bounded timeout pass. Log `/private/tmp/texttext-t11-native-settled.log`.
- `npm run test:sync:client`: 443 tests, TypeScript and the other verification checks, followed by an exact-source receipt. Log `/private/tmp/texttext-t11-client-final.log`.
- Actual PC Release smoke build and the complete interactive desktop smoke pass. The private checkout receipt is `windows/build/composition-smoke-20261017-final`; local UTF-8 copy `/private/tmp/texttext-t11-pc-desktop-final.log`, wrapper `/private/tmp/texttext-t11-pc-full-smoke.log`. WebView2 155.0.4283.60 executes the exact policy fixture and all vectors, altered replies, hidden-window evaluation, account/workspace replacement and reload rejection. The separate actual PC core run also passed: `C:\Users\Shokunin\dev\texttext-t11-core-final.log`.

The first final Mac run passed the policy tests but failed an older immediate `document.visibilityState` assertion after native close. That check now first asserts the native window actually closed and then waits, bounded to two seconds, for WebKit's asynchronous visibility notification. The original assertion remains. No product close behavior changed. Failed log `/private/tmp/texttext-t11-native-final.log`; the complete corrected run above passes.

The existing verification fingerprint now includes Windows desktop smoke sources, so changing those checks invalidates prior receipts. Mac `Package.resolved` was preserved byte-for-byte. These are private fixture/source receipts, not installed-product or physical account-switch acceptance.

## First production engine slice

Both application factories now construct a policy adapter for the existing WKWebView/WebView2 page, scoped to the verified account, workspace and connection lifetime. Startup waits for page readiness before discovery or queued mutations. Retirement rejects late replies. A missing host fails closed; neither engine retains the old known-item disposition fallback.

For an existing visible item, the native workspace writer lease remains held across the JavaScript decision. Existing native upload/install transactions still compare the captured file hash before writing. Missing items, tombstones, active editors, binary work and durable operation identity remain their existing separate paths.

Portable native unit tests inject the authoritative TypeScript host through an ephemeral **test-only** Node/tsx process. The Swift test support target and C# test helper never enter application products; the boundary suite checks this. Production uses only its existing WebView. Worker I/O is bounded and failed workers cannot lend a late response to a later request.

Passing source checks:

- `/private/tmp/texttext-t11-testhost-targeted.log`: 58 focused Swift tests and all portable C# regressions; missing-policy tests prove zero remote discovery/mutation, unchanged file bytes and unchanged journal.
- `/private/tmp/texttext-t11-no-fallback-native.log`: complete Mac/native portable gate; real WK production factory, closed-window execution, upload/pull, lease exclusion during RPC, changed-file CAS refusal and page-replacement recovery pass. The old-profile viewer was explicitly skipped because this invocation used the wrong environment-variable name; its separate corrected invocation passed before the unrelated visual fixture was interrupted, recorded in `/private/tmp/texttext-visual-wk.log`.
- `/private/tmp/texttext-parity-mirror-client.log`: 448 client checks, TypeScript and existing verification checks passed. This workspace also included four tests for a not-yet-integrated retry-policy draft; no runtime scheduling migration is claimed.
- Actual PC Release build and complete desktop smoke passed: `/private/tmp/texttext-t11-production-pc-build-1233.log`, `/private/tmp/texttext-t11-production-pc-smoke-retry.log`, full UTF-8 `/private/tmp/texttext-t11-production-pc-desktop-retry.log`. The production MainWindow factory waits for readiness and executes all vectors. Real WebView2 engine cases cover upload/pull, retained writer lease, external-write CAS refusal, failed page replacement and restart from retained state. Remote receipt: `windows/build/mirror-production-smoke-20261017-retry` in the private mutable test checkout, not an installable sealed candidate.

The first PC attempt stopped safely before the policy fixture opened: Windows' system theme registers an additional Loaded handler. The fixture now removes only the named application credential-loading handler and retains framework handlers. No credential or personal workspace was opened by this fixture. Failure: `/private/tmp/texttext-t11-production-pc-smoke.log`.

The separate actual PC core run also passed with the source policy test worker: `/private/tmp/texttext-t11-nofallback-pc-core.log`; full remote log `C:\Users\Shokunin\dev\texttext-t11-nofallback-core.log`.

## Next boundary

Retry/outbox and lifecycle consolidation remain T11 work. The pure retry draft is not yet wired to controllers; authentication wakeups, discovery retry loops and queue ordering/budget differences must be resolved before replacement. This first slice is not completed native policy consolidation or installed acceptance.
