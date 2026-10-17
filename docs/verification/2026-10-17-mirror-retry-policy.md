# Shared mirror retry timing

October 17 T11 slice following the [known-item policy migration](2026-10-17-mirror-policy-host.md). Source verification only until installed identities are recorded.

## Contract

The packaged TypeScript policy now owns native mirror retry timing. Both existing page adapters validate the same fenced request/reply and serialized vectors. Transient failures back off from 2 seconds to a 60-second cap; local change notifications cannot shorten that delay. Ordinary eligible local work receives one 400 ms debounce. Authentication rejection parks work until a genuine credential transition. Storage failure waits for an explicit repair/file event or reopen. A missing/replaced policy page fails closed and currently requires restart/reopen.

Native code retains timers, filesystem coordination, credentials and durable queues. A 30-second read-only discovery cadence remains native so revoked permissions can observe regrant. Queue order, eligibility and lifecycle policy have not all migrated. The scheduler never changes an operation ID or payload.

Mac controller runs carry generation and task identities. Late cancelled completions cannot clear a replacement run, publish old capabilities or park newly refreshed credentials. Retirement awaits retained cancelled tasks. A late file wake during the policy reply schedules another pass without shortening transient retry timing. Windows credentials remain immutable for one bridge; a new authenticated bridge resumes retained state.

## Focused evidence

- Packaged browser policy fixture passes all reconciliation and 17 scheduling vectors offline, plus page reload fencing: `/private/tmp/texttext-t11-schedule-policy-browser.log`.
- Focused Swift: 13 connection-controller and 48 sync tests pass, including discovery/watch authentication parking, same-token/file-wake refusal, refreshed credentials, late old completion and exact pending-operation restart. `/private/tmp/texttext-t12-store-native-focused.log` also includes eight stable-store tests. The later deferred-wake guard requires the final native gate.
- Full client gate: 494 tests, TypeScript and exact-source receipt pass, `/private/tmp/texttext-publication-scheduler-final-client.log`.
- Final native gate passes, including the later run/defer guards, actual WKWebView scheduling vectors with the window closed, and the full portable Windows Core suite: `/private/tmp/texttext-scheduler-store-native-final.log`. Four explicitly opt-in disk-full/child-helper tests are skipped in this invocation; earlier dedicated receipts remain separate.

## Physical Windows checks

Release build and actual PC Core pass: `/private/tmp/texttext-schedule-store-pc-build-retry.log` and `/private/tmp/texttext-schedule-store-pc-core-full.log`. The first build found a missing test-only `System.Net.Http` import; adding it fixed compilation without changing production behavior.

The full desktop suite passes with the packaged scheduler vectors, hidden WebView2, production factory, held writer lease, stale-file refusal, authentication parking through filesystem changes, and authenticated replacement resuming exact retained bytes. UTF-8 log: `/private/tmp/texttext-schedule-store-pc-desktop-focus.log`; runner exit 0: `/private/tmp/texttext-schedule-store-pc-smoke-focus.log`. Remote receipt: `windows/build/mirror-schedule-store-smoke-focus-20261017` in the private delivery checkout.

The first desktop attempt stopped before the policy tests when its plain-contenteditable IME control did not receive composition. Preserved failure: `/private/tmp/texttext-schedule-store-pc-desktop.log`. The harness now awaits actual document/control focus before input and records focus diagnostics on failure; the full retry passed composition and all remaining checks. This does not prove the earlier focus failure's exact cause.

These are source/isolated-host checks, not installed long-running acceptance. T11 remains open until the remaining outbox/lifecycle decisions are consolidated; T24 endurance is not implied by these focused checks.
