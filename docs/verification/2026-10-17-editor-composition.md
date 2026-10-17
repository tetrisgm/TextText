# Composition across concurrent document edits

T09, October 17, source based on `a3ecddf3`; the containing commit identifies this fix. Installed artifacts remain unchanged.

## Failure and change

The production React two-view regression failed before the fix: a peer insertion received during Chromium IME composition disappeared when composition committed. The DOM intentionally stays unchanged while composing, but its older full string was then diffed against the latest CRDT as if it were authoritative.

The shared editor now captures the starting text identities and reuses the existing identity-aware reconciliation when composition commits. Only surviving baseline characters may be deleted; peer insertions survive overlapping replacement. The result is schema validated before mutation. An unprovable merge retains the local draft through the existing recovery path. Composition has a separate undo boundary and its caret is mapped into the merged result. MarkdownSurface keeps its mounted element and avoids reusing an obsolete windowed text model.

## Checks

All commands exited 0 after the fix:

- `node src/local-vault/__tests__/session-views.browser.mjs`, and again with `--native`: actual Chromium composition via CDP, incoming edit while composing, committed Unicode text, caret placement, separate undo/redo preserving the peer, cancelled composition with a peer edit, overlapping replacement with a peer insertion, same DOM instance, offline release/reopen exact content. The native mode uses the controlled native adapter; it is not a physical Windows/Mac IME receipt.
- `node --import tsx src/local-vault/__tests__/epoch-adoption.browser.mjs`: existing real-client/store adoption, focus/caret/history, retry identity and failed-checkpoint regressions.
- `npm run test:sync:client`: 439 Vitest tests plus the gate's other checks and exact-source receipt.
- `npx tsc --noEmit`.
- Focused identity/pre-ready/MarkdownSurface suites: 150 tests; FieldInput suite: six tests.

Private logs: `/private/tmp/texttext-t09-ime-{before,after,caret-undo,overlap,native-overlap,epoch-regression,types,client,reconcile-unit,unit}.log`. The before log records the peer-preservation assertion failure. Concurrent mutation in the two-view fixture uses another handle to the production owner; it does not claim a networked physical peer.

## Remaining boundary

Physical OS IME/installed verification remains separate from the controlled host fixtures below. Do not infer those passes from Chromium composition. This changes no persisted format; revert the containing code change if needed while preserving journals/content, but retain the regression that exposed the loss.

## Clean and pending epoch replacement

The new `epoch-adoption.browser.mjs --ime` case passes with a held pending upload while Chromium composition spans a real client/store epoch replacement. The separate `--ime-clean` case initially failed: a clean native queue repeatedly checkpointed the old epoch instead of adopting the changed server epoch. The diagnostic captured the unchanged editor and alternating read/checkpoint requests.

A host with a live document-rebind callback now uses the existing persisted recovery/adoption transaction even for a clean queue when a server read proves a changed epoch. Hosts without that capability keep their prior clean-reopen fallback; the existing unit assertion remains. No alternative epoch journal or writer was introduced. Both composition variants preserve the mounted body, focus, peer text, server convergence and undo of only the composition.

The complete 439-test client gate passes after retaining the no-rebind fallback. All three browser modes (default, `--ime`, `--ime-clean`) passed. Private logs: `/private/tmp/texttext-t09-clean-epoch-client-final.log`, `/private/tmp/texttext-t09-final-epoch-{default,ime,ime-clean}.log`; failing clean diagnostic `/private/tmp/texttext-t09-ime-during-epoch-diagnostic.log`.

## Repeated ownership bounds

`node src/local-vault/__tests__/native-session-owner.browser.mjs` now acquires two handles, detaches/releases both and checks the closed phase for 25 consecutive cycles. Instrumented global window/document listener registrations and live interval handles return to the pre-owner baseline after every cycle. Native open/close counts remain actual cumulative totals. The later failed-checkpoint/recovery assertions still pass. Log `/private/tmp/texttext-t09-owner-resource-bounds-final.log`.

This is bounded listener/interval/lease evidence, not a heap leak measurement or long soak. The fixture retains some handles for assertions; native OS resources and installed foreground/background behavior have separate gates.
