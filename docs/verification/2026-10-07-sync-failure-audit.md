# Sync failure audit

## Reproduced failures

1. Retained Mac editors outlived their native session when a window closed or
   credentials refreshed. Fixed in `454410c1`, installed build 1172. See
   [lifecycle receipt](2026-10-07-editing-session-lifecycle.md).
2. A retryable HTTP 503 containing “Storage temporarily unavailable” entered
   terminal error state because message-word matching overrode HTTP semantics.
   The new regression failed with `error` instead of `offline`. HTTP 429 and
   5xx now retain pending edits and retry regardless of those words. Local
   persistence/validation failures and permission/epoch fences remain intact.
3. Successful reads reset the failure counter used by uploads. With reads
   working and writes returning 503, the new regression observed seven retries
   one second apart. Read and upload counters are now separate. The regression
   verifies 1, 2, 4 second intervals, then eventual successful delivery. A read
   cannot change a failed upload's status back to saving.

Items 2 and 3 are reproduced independent faults, not evidence that they caused
one particular historical screenshot.

## Coverage inspected

- Client journal replay, lost acknowledgements with stable operation IDs,
  immutable in-flight batches, interrupted reads after acknowledgement,
  visibility toggles, local checkpoint serialization and storage failures:
  `src/local-vault/collaboration-client.test.ts`.
- Server concurrency, external Markdown changes, epoch fences, deletion,
  partial durable-intent replay and audit-store outages:
  `src/lib/vault/server-collaboration.test.ts`.
- Browser/native transport cancellation and error mapping:
  `src/local-vault/web-transport.test.ts`, `src/local-vault/bridge.test.ts`.
- Native file replacement, restart replay, iCloud absence versus explicit
  deletion, concurrent remote edits, recovery and origin attribution:
  `mac/Tests/TextTextFileProviderKitTests/LocalVaultSyncTests.swift` and
  `LocalVaultSharedEditingTests.swift`. These existing native cases were
  inspected, not rerun for the TypeScript-only corrections.

## Verification

93 tests passed across the four affected client/server/transport suites.
TypeScript check passed before the additional table-driven HTTP cases; those
cases are included in the 93-test run. Both newly exposed failure classes were
first reproduced against the previous implementation.

## Remaining limits

This is not a blanket reliability certification. In-flight requests carrying
old credentials while tokens refresh still need an explicit failure test.
Process-kill fault injection across the whole native-to-Oracle path and a real
second Apple device's iCloud behavior are not established by unit fixtures.
The new TypeScript fixes require packaging/install and Oracle web deployment
before they protect both running clients. Build 1172 remains installed.

## Durable regression suite

`npm run test:sync` runs the file-sync and collaboration tests with two workers,
then native tests with two Swift jobs. It opts into the real Swift HTTP contract
fixture, using temporary local folders and a temporary loopback server only.
The normal human-invoked release runs it; web-only release runs the native
portion in addition to its full web tests. No watcher or scheduled build exists.

Additional confirmed fault: a native request started before token renewal could
return 401 after renewal and permanently retire the editor. The relay now retries
an idempotent collaboration read/push once when the bound workspace is unchanged
and the credential has changed. Same operation ID/body are retained. Cancellation
and actual rejection still fail closed. Its regression failed before the fix.

The new child-process test kills a server-store writer with SIGKILL after durable
commit but before acknowledgement. Reopening and replaying that operation
preserves the committed text exactly once and clears the abandoned lock.

The combined suite passed 147 TypeScript tests and 58 native tests, including the
actual HTTP interoperability fixture. Those tests cover nonoverlapping offline
file edits converging with assets retained, overlapping changes retaining both
original packs, rename/delete races, provider absence, and zero idle uploads.

### Foundation and limits

Keep Yjs: its update operations are commutative and idempotent
(https://docs.yjs.dev/api/document-updates). Keep Apple's NSFileCoordinator for
local file access (https://developer.apple.com/documentation/foundation/nsfilecoordinator).
A new transport library does not replace the archive projection, durable
outbox, authentication or file-provider integration tested here.

Arbitrary simultaneous replacement of the same bytes has no universally correct
semantic merge. Disjoint text changes merge; ambiguous overlapping file edits
must preserve both versions. This is a data-preservation invariant, not a claim
that every conflict can disappear. Actual cross-device iCloud eviction and
transfer still require a second Apple device; local provider-absence fixtures do
not certify Apple's transport. Power-loss durability is distinct from SIGKILL.

## Live browser failure missed by the initial gates

Build 1173 correctly saved to Oracle; a raw Markdown-only edit inside the iCloud
TextPack reached Mac, search, and Safari. A subsequent Safari edit entered
recovery. Inspection exposed the vault's three cookie-auth helpers comparing
Origin with the standalone server's private request URL. The proxy-shaped
regression returned 403 for the configured public HTTPS origin. Native bearer
checks bypassed this comparison, explaining why native smoke tests passed.

The vault auth helpers now use the existing validated `requestPublicOrigin`,
with foreign and missing origins still rejected. The release smoke additionally
uses its scratch account's issued cookie, without a bearer, to test a valid
public-origin write reaches body validation and a foreign-origin write gets
403. The body-validation check cannot create a file. These auth tests are now
part of `test:sync`. This finding demonstrates why live bidirectional verification
is required in addition to the storage and CRDT fixtures.
