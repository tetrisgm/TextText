# Portable mirror policy host

T11 foundation, based on `29f18341`. No file-sync branch is switched yet; installed artifacts are unchanged.

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

## Next boundary

Connect the existing-item disposition branch in both engines while holding their existing writer leases across policy evaluation and CAS. Gate mutation on readiness, retain queues when the page fails, and prove production home/no-editor/offline behavior before removing the old branch. Retry/outbox and lifecycle consolidation remain T11 work. This foundation is not a claim of completed native policy consolidation or installed acceptance.
