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

Physical OS IME in WKWebView/WebView2, composition spanning a full epoch replacement, and repeated-open resource bounds remain separate T09 gates. Existing epoch checks run without an active composition. Do not infer those passes from Chromium composition. This changes no persisted format; revert the containing code change if needed while preserving journals/content, but retain the regression that exposed the loss.
