# Windows interactive browser relay verification

Driver-only transport extension. Installed product remains `a0413982`; public web remains `4eca8353`. No acceptance campaign or real browser was launched by this verification.

## Contract

The PC web role gains three sealed runtime files: `stress-browser-relay.mjs`, `stress-browser-task.ps1`, and `stress-browser-child.mjs`. Source/config/role attestation precedes task creation. Preflight requires role `pc-web`; any explicit headless value must be false and any explicit channel must be `msedge`. Missing role, foreign role, and contradictory browser settings refuse before seal verification or session creation. The adapter itself hardcodes headed Microsoft Edge. The unchanged browser adapter receives every JSONL line; identity remains opaque. Current runtime, owned process/session, last merged feature flag, and Security audit must pass before forwarding initial or restarted attestation.

Requests retain the adapter's 65,536-character limit; replies retain the coordinator's 262,144-character limit. Streaming UTF-8 is fatal on malformed bytes. Defaults are 420 seconds, with an explicit two-hour maximum. Error/EOF/deadline requests orderly shutdown; blocked or live children retain evidence and refuse success. No force termination is used. Successful cleanup removes only the exact owned exited task.

All three runtime hashes are pinned only for `pc-web`. The relay test is registered in official Windows/manual gates; all runtime/test files are fingerprinted by sync verification. Existing Mac role inventories are unchanged. A fresh coordinator source and PC web seal are required before actual use.

## Checks

- Mac focused relay/artifact-source/verifier: **61 passed, one explicit Windows-only PowerShell semantic skip**, zero failures. Log: `/private/tmp/texttext-browser-relay-preflight-final-mac-20261019.log`.
- Actual Windows relay tests: **27 passed, zero skipped**, including actual PowerShell literal/regex semantics and dangling-junction refusal. PowerShell parsing also passed.
- Actual Interactive session 1 controlled fake-child roundtrip: exact every-line forwarding, exit 0; child PID 46856 naturally exited and own task was removed. This exercised exported relay/pump transport, **not** the production task entry, Edge, authentication, or product content.
- Before/after Security observations found no matching 4625/4740 events; existing mitigation remained present. Normal PID 33756 remained absent. Legacy source and backup reverified unchanged: 1,110 files, 103 directories, 7,340,498 bytes; inventory SHA-256 `16faaf065abc0843f8196e9be33f3181eccca7960a7dba6062a7b00d6cf1f062`. Unbound conflicted work remains retained.

## Evidence and limits

Private evidence: `/private/tmp/texttext-browser-relay-controlled-final-_brw41at` and the same basename under PC Temp. `input-manifest-final2.json` binds ten named overlay paths to committed base `b7c5a586657885af167b0432e13833bf80d61ad2`, archive SHA-256 `32785adc2a6b16f4196ef73e3619ff60f3592bc6858672fe3f876b227b63b63f`. The final preflight follow-up changes only the relay and its test; actual Windows 27/27 and Mac 61 plus one Windows-only skip passed. Follow-up logs are `/private/tmp/texttext-browser-relay-preflight-final-{pc,mac}-20261019.log`; the refreshed final manifest supersedes the earlier input hashes for those two files. Roundtrip and cleanup proofs are `controlled-roundtrip-final-result.json` and `controlled-cleanup-final.json`.

Earlier preparation, literal-escaping, and Windows-only missing-test-import failures remain preserved in private evidence. The final gate includes their corrections. No sealed product artifact was patched. Production interactive browser relay validation awaits review, commit, a fresh standard PC web seal, and runtime authorization. No all-six, mutation, or asset-readiness claim is made.
