# Account-bound retained work

T07 prerequisite for T08 session extraction. Implementation starts after adapter conformance; this is the intended contract, not a completed security claim.

## Identity and lifetime

Use the server-resolved stable actor user ID, origin, workspace and item as the persistence/session key. A bearer token, token hash, email or display name is not an account ID. The browser receives the nonsecret actor ID from its authorized server page. Native clients obtain it from the authenticated account discovery response and cache it with their existing private credential record for offline reopening. Credential replacement must create a new lifetime; delayed operations retain the old captured principal and cannot inherit replacement credentials.

A new account must never auto-replay another account's journal, even when both accounts can edit the same item. Browser requests carry the captured expected actor ID; the server compares it to freshly resolved authorization before accepting the request. This also fences a tab whose cookies changed through another tab without a React remount.

## Existing unbound journals

Account-scoped browser records use a new key namespace. Preserve old records exactly. A clean legacy record can be left unused while a fresh authorized baseline opens. A pending, retired, recovering, unreadable or divergent legacy record must block automatic replay and expose retained recovery; it is never silently attributed to the currently signed-in account. An account-labelled journal may reopen only under that account. Recovery adoption requires an explicit authorized user action, not an automatic migration.

Native retained checkpoints require the same principal boundary. Browser key scoping alone is insufficient because native open also returns a retained journal. A mismatched or ambiguous pending native checkpoint must remain protected rather than be handed to a new writer. Credential/account discovery and offline cached identity must be verified before enabling the native slice. Same-account token renewal should preserve stable identity, while a different user must not reuse its session.

## Regression sequence

1. In one storage/profile, A opens an editable item, goes offline, accepts an edit, checkpoints and releases.
2. B opens the same item with independently valid edit permission. B sees its authorized baseline; A's journal bytes remain exact and no A operation is submitted as B.
3. A reopens, recovers the same pending operation identity and can upload exactly once after reconnection.
4. Switch browser cookies from A to B while A's tab is alive: server rejects the expected-principal mismatch before content mutation; A's retained work remains.
5. Repeat through native credentials and retained checkpoints, including offline reopening, token renewal, account replacement and late completion. Unknown legacy pending data must stay recoverable and never count as a clean checkpoint.

T08 may then acquire/release handles keyed by these identities. Its state machine must retain errors and ownership until accepted local work is durable; it cannot infer account ownership from editor view lifetime.
