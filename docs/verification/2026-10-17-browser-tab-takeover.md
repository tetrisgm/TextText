# Browser tab takeover

T09 source verification, October 17. Run `node --import tsx src/local-vault/__tests__/session-takeover.browser.mjs` (exit 0; local log `/private/tmp/texttext-t09-tab-takeover.log`).

Two real Chromium pages share one origin/IndexedDB but acquire distinct Web Locks and journals through the production session owner/client. Both accept and commit offline edits. The relay is the production file-backed collaboration store in a disposable directory, with its normal operation receipts.

In separate cases the first tab's upload is held before server commit and after server commit but before response delivery. That tab is destroyed without its application release hook. A third page acquires its orphan journal while the second page retains its live journal. The third page replays the identical operation ID. Delivering the old held request afterward does not increment the server sequence. Both surviving pages, journals and server converge with each accepted marker exactly once and no pending changes.

No production change was needed: per-browser-document journals and Web Locks already provide this behavior. This proves abrupt tab destruction, not an OS process kill, native process exclusion, or physical six-client acceptance. No installed/deployed version changed.

Next: native competing-actor/process regression. Inspection found in-memory `sharedSessions`/`collaborating` ownership and an adoption lock that allows multiple ordinary actors. Verify separate native actors cannot acquire the same document before claiming native process safety.
