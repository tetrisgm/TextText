# In-place external file merge

## Changes

`c392f477` routes native file-change notifications through the existing serialized
checkpoint drain. A failed compare-and-swap reads the fresh same-ID file and
reconciles it against the last materialized snapshot and live Yjs document.
It retains the native lease and editor. Independent edits and concurrent
insertions join the active collaboration history instead of closing it.

`3082bb49` fixes an additional undo defect found by regression testing. Replacing
the merged body erased the CRDT identities referenced by earlier undo entries.
Even a minimal string diff incorrectly attributed equal boundary spaces.
The client now maps the external edit from the saved base through the local edit,
checks the projected result against the validated merge, and applies that span.
Human undo/redo preserves the external insertion.

## Automated evidence

Exact-source core gate passed: 851 tests, TypeScript, and both initial-note and
CLI-created-note browser scenarios. Browser assertions retain the same editor
element and focus across pending typing and external edits, and verify undo/redo.
Log `/tmp/texttext-inplace-undo-core.log`.

## Physical PC

Production MainWindow and WindowsBridge, normal authentication and Oracle,
with isolated WebView profile and dedicated fixture only. UI source `3082bb49`;
app.js SHA256 `a1a2c2146ba8d9019cac1b3fd5d3abe216a84dd2952eb10137f79bd3a8750e9f`.
Native assembly SHA256
`d0950ae041c913424b799b2cf83304a9c0b386c8ef9ec63e6b612cc1b8274e17`.

Run `inplace3082`: ten native typing inputs one second apart, atomic PowerShell
TextPack edit at start + 2.1 seconds, then 15 seconds of observation. Passed
visible-editor and persisted-file assertions with every marker exactly once.
No editor gap or recovery notice appeared in the 100 ms samples. PC receipts:
`C:\Users\Shokunin\dev\texttext-live-acceptance-3082\receipts`.
Independent Mac iCloud-file inspection also found all eleven markers exactly
once, pack SHA256 `caab1ce4972e198c617d1c8625e742a54af9cae8ece304471767ebc34856b7b4`.

An earlier candidate run failed at native file activation before typing. The
diagnostic retry opened the same file and passed; this intermittent activation
failure is not explained or fixed. Receipts remain intact.

Run `continuity3082`: twelve inputs 500 ms apart and atomic CLI replacement at
start + 1.1 seconds passed. A MutationObserver retained the original body element
and confirmed it was never removed, including between 100 ms samples. Final
visible-body SHA256 `8471061a12660144eaf1b64fb96efc1d24136de67cbfeadcc394b57949d643b1`;
pack SHA256 `609ebe70599f59b2ee8d8c3f031615ae96010daf6a462748337c379478ad090e`.
PC receipts `C:\Users\Shokunin\dev\texttext-live-continuity-3082\receipts`;
local `/tmp/texttext-continuity-3082-events.jsonl`. The strengthened runner builds
with zero warnings/errors and fails any observed editor removal.

## Limits

This is two simultaneous actors with independent Mac convergence inspection,
not six clients. The runner explicitly refocuses the caret before each input;
natural cursor continuity is covered by the browser/unit tests, not this run.
Overlapping replacements, custom template-source changes, crash windows,
multiple external importers and the complete six-client fault schedule remain
unfinished. Neither installed client nor Oracle was replaced for these tests.
