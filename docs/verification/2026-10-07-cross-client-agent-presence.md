# Native agent presence and close durability

## Shared behavior

Mac and Windows use `src/local-vault/agent-presence-client.ts` from the always-mounted
assistant. Hiding the panel does not end an active task. Task completion,
cancellation, process/account failure, workspace replacement, and teardown stop
presence. An aborted readiness lookup cannot later create a participant. Presence
lookup does not delay the actual agent request.

Presence uses the existing file-vault endpoint. Only an authenticated native app
with edit access may supply `{agent: {name, taskId}}`. The server derives the owner
identity, binds session credentials to account/task/item/epoch, and rechecks access
inside the commit lock. Human presence remains unchanged. Clients check an explicit read-only capability
before announcing an agent, so older servers cannot mislabel it as a human. Mac no longer publishes
through the legacy document presence route.

Windows close and logout await `texttextFlushForSignOut` through an explicit
nonce-bound renderer reply. The native file bridge remains available until that
reply confirms persistence. Failed saves or timeout keep the window and account
open. The implementation does not mistake WebView2's immediate JavaScript Promise
result for completed persistence.

## Verification

- Shared presence lifecycle: 5 tests passed, including task isolation, canceled
  readiness, read-request field restrictions, native-process shutdown, and timer cleanup.
- Vault presence API/store: 16 tests passed, including native attribution,
  forged identity rejection, account/task/expiry fencing, leave, and grant revocation.
- Swift collaboration/agent filters: 39 tests passed. Receipt:
  `/tmp/texttext-agent-presence-swift.log`.
- Windows agent subprocess and renderer flush checks: 6 checks passed via
  `dotnet run --project windows/TextText.Agent.Tests/TextText.Agent.Tests.csproj`.
  The fake subprocess uses no real account or model. Close checks verify delayed
  acknowledgment, foreign acknowledgment rejection, failure, and timeout.
- Windows shell cross-compilation passed with no warnings or errors.

These receipts do not prove live Windows ChatGPT authorization or a real Windows
window-close UI interaction. Those require the PC product verification receipt.
The shared presence tests and endpoint tests are included in both sync Vitest
configurations, so later client work runs the same regressions.
