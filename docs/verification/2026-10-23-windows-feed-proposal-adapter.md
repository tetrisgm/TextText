# Windows built-in assistant feed proposals

The Windows folder assistant now advertises `propose_feed` only for a verified connected account and a nonempty captured folder. The adapter stages `proposal:add_feed` through the existing authenticated command endpoint, with top-level `expectedWorkspaceId`, captured destination and host-generated operation identity. Model-supplied folder/workspace overrides are rejected. It never fetches the feed or subscribes directly; the server retains review, approval, audit and retry ownership.

Task cancellation and bridge retirement fence requests and late results. An already staged server proposal cannot be undone merely by canceling its response. The returned compact receipt preserves `approvalRequired`, proposal ID, review URL and message from the actual MCP `structuredContent` or text-content envelope. A review URL is required; MCP errors and malformed receipts cannot become success. Independent response-contract review found no remaining blocker.

Checks on the integrated source:

- Production-shaped authority/response helper: 14 passing assertions, `%TEMP%/texttext-feed-windows-integrated.log`. The original scratch parser reproduced a failure on the actual server envelope before correction (`texttext-windows-feed-adapter-66fc564dbd9e4e579b42ef3e9589f279/response-baseline-red.log`).
- Full Windows Agent suite passed, including five new production-controller subprocess scenarios: connected folder, disabled capability, root folder, item scope and canceled task. `%TEMP%/texttext-feed-agent-integrated.log`. The app-server is a test protocol fixture, not an installed assistant acceptance.
- Full Windows bridge suite passed, including readiness pressure and queued arbitration: `%TEMP%/texttext-feed-bridge-full.log`.
- WPF Release build passed, zero errors and the existing NU1510 warning: `%TEMP%/texttext-feed-wpf-integrated.log`.

No Core source changed in this adapter slice. Mac has no dotnet available for these checks; PC native checks are the platform-specific gates. No owner catalog/content was modified. Not yet released or verified through the installed assistant; the next same-commit release and real proposal acceptance remain pending.
