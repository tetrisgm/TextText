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
