# Certified native handoff retry

## Scope

Future source verification only. Installed Mac 1268 remains a separately preserved failure: profile-lock busy during zero-input handoff, no supported safe close/retry in that installed version. These checks do not establish installed acceptance or resolve an unknown native owner.

The native `handoff_not_open` certificate is limited to requested handoff version 1 and typed preparation busy before engine open, with current account/request and no relay session for the item. It is not a generic busy-message match or a claim about other processes. Native stable-profile shared-lock fixes and their 45-test gate are recorded separately by the native worker.

## Retry behavior

- At most three automatic retries within a one-second retry window, using 100/200/400 ms delays and the existing bounded native request timeout. Current owner scope is checked around every await.
- After certified exhaustion, Retry connecting revalidates account/workspace/item/root and exact requested file identity/hash, then exclusively disposes only the failed page owner with no native token/client. Direct file writing stays paused; local typing/draft capture continues. No draft is cleared by retry.
- The background shared controller mounts only after native open, floor proof and baseline readiness, avoiding a second owner reference before a failed open.
- Unknown/lost reply, missing floor proof, changed account/epoch or generic failure retains recovery and blocks close. A fresh account/config validation failure preserves Retry only while the original certified unpublished owner, scope and draft remain current; returning to the original account is revalidated before cleanup. A previous certificate cannot authorize cleanup after a later uncertain response.
- Startup version-2 recovery retries preserve the exact stored Yjs intent and replay it after successful open. No snapshot rediff, extra operation, epoch reset or local direct write is introduced.

## Checks

Registered client: 52 files, 593 tests passed; TypeScript passed; verifier registration: 12 passed, zero skips.

Logs: `/private/tmp/texttext-certified-retry-client-final-20261018.log`, `/private/tmp/texttext-certified-retry-tsc-final-20261018.log`, `/private/tmp/texttext-certified-retry-verifier-final-20261018.log`.

Six new controlled browser cases passed: transient certificate, exhausted certificate plus explicit retry, unknown open, changed account before retry, published open lacking proof, and version-2 startup retry after prior native ACK plus peer append. Logs are `/private/tmp/texttext-certified-handoff-{once,retry,unknown,account,unverified,startup}-first-20261018.log`.

Five existing controlled regressions passed on final product source: controls, pre-handoff article capture, restart with exact updates, title input during baseline wait, and continuous body typing during open. Logs are `/private/tmp/texttext-certified-retry-{controls,capture,restart,title,body}-regression-20261018.log`.

All disposable browser children exited and contexts closed. Fixtures use controlled transports and actual editor input/journals, not live accounts or user roots. They prove source boundaries, not six-client or installed-app acceptance.

## Review follow-up

The account-return fixture first reproduced a recoverability defect: validation refused cleanup correctly but permanently hid Retry. `/private/tmp/texttext-certified-retry-account-return-red-20261018.log` preserves that failure. The narrow catch now preserves the still-valid certificate after rechecking original ownership/draft scope; `/private/tmp/texttext-certified-retry-account-return-green-20261018.log` proves changed-account refusal followed by restored original config, same mounted Title, exact text/draft transfer and normal-close success. No native owner is opened or disposed during the mismatch. Final client/TypeScript and unknown/unverified refusal regressions use the `texttext-certified-retry-*-account-final-20261018.log` logs.
