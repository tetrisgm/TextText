# Saved file move recovery UI

Source UI and transport proof only. Native actor integration and bridge runtime checks are separate. This source is not installed or deployed.

The shared Recovery dialog exposes saved file moves with original, requested, current local and current server names. A fresh native inspection must match the original operation, item, paths and immutable request hash before any action is offered. Retry is permitted only for a verified pending request; keeping current names requires a verified terminal rejection. Ambiguous, stopped and legacy review states offer no mutation. The native actor remains responsible for current scope, exact receipt, lifecycle and durable state validation.

Actions send the captured workspace transport, original operation, immutable request hash, fresh inspection and explicit consent. Workspace switches and unmounts invalidate pending inspection and action replies. Raw native errors are replaced with bounded recovery copy. Neither successful UI action nor keeping names promises that all content synchronization has resumed.

Windows transport overwrites caller-supplied root, workspace and account with its selected native scope. Saved moves remain visible when hosted history is offline, including alongside pending folder recovery. Native list filtering is requested before its bounded 100-row limit.

## Gates

- Fourteen unit tests pass across `SavedFileMoveRecovery.test.ts` and `windows-recovery-transport.test.ts`: strict row validation, malformed IDs/tokens/paths, forbidden phase/action combinations, exact Unicode spelling, scoped transport and offline list behavior.
- `node src/local-vault/__tests__/saved-file-move-recovery.browser.mjs` passes against the real React component in Chromium: exact consent payload, terminal-only keeping, ambiguous/stopped refusal, changed-item rejection, captured transport, stale read and action isolation, redacted errors, and Recovery dialog refresh.
- The browser test is registered in `sync/verify.mjs`. Light and dark screenshots were visually inspected: `/private/tmp/texttext-saved-file-move-light.png` and `/private/tmp/texttext-saved-file-move-dark.png`.
- `npx tsc --noEmit --incremental false`, JavaScript syntax checks and `git diff --check` pass.

Logs: `/private/tmp/texttext-saved-file-move-ui-browser-first-20261019.log` and `/private/tmp/texttext-saved-file-move-ui-tsc-20261019.log`. Browser tests use synthetic native replies; they do not prove installed native actor behavior or physical multiplayer acceptance.
