# Captured local durability barrier (T07)

Invariant: close waits for accepted local input to become durable. Later remote traffic must not keep moving that barrier; additional local input accepted while waiting must still be covered. A retired lifecycle cannot authorize close.

## Reproduction

A production `FileCollaborationClient` with an injected delayed native checkpoint saved its initial state, accepted a local edit, and began close. A second real Yjs client committed a remote edit while that checkpoint was held. Releasing the first checkpoint started a second, blocked remote projection. The old close promise remained pending even though its accepted local edit was durable. A separate test destroyed the client while its final checkpoint was delayed; the old typed reply incorrectly returned `durable` when that checkpoint later succeeded.

Before the fix, the three focused regressions produced two failures and one pass. The passing case confirms an in-flight barrier must wait for additional accepted local typing. Log: `/private/tmp/texttext-t07-before.log`.

## Implementation

The engine tracks local edit version separately from journal generation, which also advances for remote/acknowledgement traffic. Each persistence wait captures a target generation. Native flush wakes after each checkpoint commits rather than waiting for the whole continuously active drain. It extends the target when additional local input was accepted; remote changes alone do not extend it. Browser transactional flush uses the same local-input distinction.

Typed results reject a client destroyed during the wait or an epoch replaced during it. Boolean cleanup flush still permits already queued disk work to complete after view teardown; it does not grant a current lifecycle receipt.

No journal schema or network format changed. Storage rejection, invalid journals and native checkpoint errors remain nondurable. This does not complete the native final-release input fence or account-change contract; those remain T07/T08 work.

## Verification

- `node node_modules/vitest/vitest.mjs run src/local-vault/collaboration-client.test.ts src/local-vault/navigation-flush.test.ts`: 101 passed.
- `npm run test:sync:client` from a pristine `4102b6a2` archive plus the two changed source/test files: 410 passed, runner tests and TypeScript passed; exact-source receipt recorded there.
- `node --import tsx src/local-vault/__tests__/epoch-adoption.browser.mjs`: real Chromium epoch adoption and transactional journal recovery passed, including late edits, caret/undo continuity and failed native adoption checkpoint.
- Diff whitespace check passed. Logs: `/private/tmp/texttext-t07-after.log`, `texttext-t07-gate.log`, `texttext-t07-browser.log`.

This source fix is not in Mac build 1261, the current Windows candidate, the prepared Oracle archive, or the still-active Oracle deployment. Deliver it through a later coherent verified candidate; do not relabel the existing artifacts as containing it.
