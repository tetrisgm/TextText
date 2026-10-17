# Browser document session ownership, October 17

T08 first production slice, based on `2c96c164`. Source only; installed apps and Oracle are unchanged. T07 physical account transitions remain open.

The page-level owner keys sessions by origin/account/workspace/item and assigns each owner a lifecycle. Multiple React views acquire the same collaboration client. Last release pauses transport, awaits opening and local persistence, then closes. Reacquiring during drain invalidates the old close. Failed persistence retains the same client and document for recovery. Exclusive reset refuses while another view holds the document. A captured web requester cannot pick up a subsequently installed account transport.

The browser runtime now owns its client, persistence, transport, projection refresh and visibility subscriptions. Epoch adoption awaits every attached view's rebinding. Existing native checkpoint ownership and view-scoped presence are intentionally the next migration slices; this does not complete T08/T09. No additional runtime or cross-process singleton assumption was introduced.

Explicit journal retirement now awaits its IndexedDB tombstone before releasing the writer lease. A failed recovered-journal retirement keeps pending in-memory content. Ordinary last release keeps the journal for restart.

## Evidence

- Ten ownership tests cover shared acquisition, idempotent release, delayed commit, reacquisition during drain, retained save failure, cancelled open, account/workspace separation, exclusive reset, asynchronous close, and unmount during retirement. Production client/bridge retirement and captured-transport checks bring the focused run to 125 tests, all passed: `/private/tmp/texttext-t08-owner-focused.log`.
- Real Chromium plus production client/IndexedDB: two handles share one client, drain waits for commit, reacquire fences stale completion, restart preserves text, storage rejection retains the original owner, another account does not replay its edits, reset awaits its tombstone. `node src/local-vault/__tests__/session-owner.browser.mjs`, exit 0; `/private/tmp/texttext-t08-owner-browser.log`.
- The first fixture acknowledged uploads without applying them; the restart assertion correctly failed. The fixture now refuses uploads as offline, so it cannot falsely acknowledge a save. No production persistence behavior was changed to satisfy that false ACK.
- Production React editor test: one collaboration open serves two editors; typing appears in both; unmounting one preserves the remaining editor element; offline last release/reopen restores exact text with zero uploads. `node src/local-vault/__tests__/session-views.browser.mjs`, exit 0; `/private/tmp/texttext-t08-views-final.log`.
- `npm run test:sync:client`, exit 0: 433 tests and TypeScript; `/private/tmp/texttext-t08-client-final.log`. Ownership tests are included in both client and core sync gates.
- Existing real-browser account/session and native epoch-adoption suites pass unchanged: `/private/tmp/texttext-t08-{web-session,native-epoch}-final.log`. The latter uses the production file relay with a native bridge fixture; it is not installed native acceptance.

## Next

Move native open/checkpoint/file-reconciliation ownership into the same coordinator, including explicit native writes and presence. Retain the current native path until its replacement passes checkpoint/close/epoch and real WebView checks. Then finish T07 installed account transitions and T09 process/continuity acceptance. Cross-process takeover, full six-client acceptance and performance remain unverified. No persisted format version changed; original journals remain available on rollback.
