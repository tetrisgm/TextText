# T07/T19 account-scoped workspace routing

Web transport deliberately scopes durable storage roots to [accountId, workspaceId]. VaultApp previously sliced that encoded root and treated the whole tuple as the route workspace ID for sharing, comments and publishing. The regression failed for two accounts sharing one workspace and malformed roots in `/private/tmp/texttext-web-workspace-routing-red-20261018.log`.

A validated parser now extracts only the route workspace identity. The account-scoped root remains unchanged for storage, drafts and transport binding. Supported legacy roots still parse; malformed tuples and unsafe identities refuse.

Focused parser/transport checks pass 39 tests (`/private/tmp/texttext-web-workspace-routing-green-20261018.log`), TypeScript passes (`/private/tmp/texttext-web-workspace-routing-typecheck-20261018.log`), and the actual VaultApp browser fixture copies the correct workspace folder URL from an account-scoped root without content/access mutations (`/private/tmp/texttext-web-workspace-routing-browser-final-20261018.log`). The first browser fixture attempted a generic esbuild bundle and hit the expected server-import guard; it was corrected to the existing product local-vault bundler. No installed/deployed acceptance is claimed.
