# Mac handoff prepublication proof and stable saves

## Native scope

Requested handoff version 1 now maps only the typed profile migration `busy` failure during synchronous account/profile preparation to `handoff_not_open`. The catch ends before `beginSharedEditing`. It additionally requires the captured account still matches, the task is not cancelled, and no relay session for that item exists. This proves no engine opening was attempted for that request; it does not prove another process has no session. Generic errors, account failures, cancellation, engine-opening failures, and postpublication failures retain their existing errors.

The real relay fixture holds a shared lease at floor 3, checks the exact code and unchanged profile, releases the lease, then successfully opens/closes. At floor 4, the existing held-reader fixture succeeds without migration.

A separate actual `LocalVaultDocumentStore.write` fixture exposed another no-op exclusive preparation: stable floor 4 plus an independent shared reader threw typed `busy`. Generic preparation now uses the existing shared verification path for an already version-2 owner. Initial owner migration and incomplete retained recovery keep exclusive locking. The existing concurrency test now distinguishes harmless no-op preparation from actual floor 1 to floor 2 migration, which still refuses while a reader holds the lease.

## Evidence

- Store-write RED: `/private/tmp/texttext-handoff-store-shared-lease-red-20261018.log`, one executed/one failure, typed `busy` at the production write path.
- Prepublication proof GREEN before generic preparation change: `/private/tmp/texttext-handoff-prepublication-proof-final-20261018.log`, 33 tests, no skips/failures.
- Final combined GREEN: `/private/tmp/texttext-handoff-stable-prepare-semantic-final-20261018.log`, exit 0, 45 tests, no skips/failures. Includes actual prior CLI refusal, pending checkpoint preservation, interrupted publication, future-format refusal, account fences, stable Store write with exact reopened document body, and relay opening.
- Final filter: `LocalHandoffBridgeTests|LocalHandoffProfileTests|FolderPropagationProfileTests|LocalVaultCollaborationTests|RetainedReplacementProfileTests`; Store and stress-actor flags, pinned prior CLI opt-in.
- Package lock restored exactly: `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.

Installed failure evidence remains preserved. These isolated results do not establish the exact installed failure call site or physical acceptance. No live workspace/profile, installed app, or account was modified.
