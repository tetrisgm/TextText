# Mac 0.204 (1175) agent presence verification

Local installed candidate built from `d558cb42` in `/tmp/texttext-final-d558cb42`.
The authorized local Store workflow preserved the existing Apple Development identity, native Apple sign-in entitlement, account, iCloud workspace and Codex 0.153.4 runtime. All three extensions remain registered; deep strict code-sign verification passed. No public release was published.

The build regenerated exact-source sync receipts (230 shared tests plus the native gate). Swift release build passed. The cached App Intents guard rejected snapshot source timestamps; the normal Xcode metadata pass then succeeded. Installation used the established sandbox-private runtime-health exception with binary verification enabled. Runtime health attestation is not claimed.

Startup reopened the existing test note and account. An actual read-only Codex turn completed and preserved the title and all six verification markers. The whole ZIP changed during normal synchronization, so byte-for-byte ZIP preservation is not claimed. The nested Markdown before the final presence verification has SHA-256 `945e21c8b797d705d92d9d730c508032caef3758d48c64245ad0e972180e4bee`.

## Server root cause and regression

Live verification still showed no agent badge after the readiness fix. The server's vault storage accepted only `account:` principals at join, row read and leave; the authenticated route generated `native-agent:` identities. Route tests mocked storage and therefore missed the rejection. Commit `4712e8d9` validates both account and canonical structured native-agent identities at all three boundaries. Real filesystem-store tests now exercise the route's identity helper, encrypted session credential, join/read/heartbeat/leave, cross-principal denial, expiration and malformed identities. The focused presence/session/route suite passed 20 tests; TypeScript passed.

## Installed hashes and logs

- Native executable SHA-256: `ffa381939b9d01a75ec5ad256cb336fc0be85b36bcba27c497eef0b3e6f389a5`
- Shared editor `app.js` SHA-256: `2e2d1fa6f95ff8a6ba6f3d5cdbfb86dce3999c8664a408cef88a82ac6fa07190`
- `/tmp/texttext-mac1175-build.log`
- `/tmp/texttext-mac1175-install.log`
- `/tmp/texttext-agent-store-presence-tests.log`

## Live result after server deployment

Against Oracle release `texttext-oracle-20261007T223538Z-4712e8d9`, another actual read-only Codex task ran on the same test note. The Mac accessibility tree displayed `2 people here: Codex (agent) · TextText on Mac, ramine@ramine.net`; the coordinating task independently observed Safari display `2 people here: Codex (agent) · TextText on Mac, TextText on Mac`. After task completion the agent entry disappeared while human peers remained. The nested Markdown SHA-256 was still exactly `945e21c8b797d705d92d9d730c508032caef3758d48c64245ad0e972180e4bee`, proving the read-only task did not change its text. All six markers and the title remained intact.

The Mac's temporary deployment connection banner cleared automatically without pressing Retry. No additional Mac rebuild was necessary for the server fix. This establishes actual Mac agent read/edit integration and cross-client agent presence on the deployed server; it does not claim Windows live-agent authentication verification.
