# Bounded sustained typing runner, October 18

Source implementation and orchestration evidence only. This does not complete
T21 or attest a physical sustained typing case. Both native private actors
compile; current six-client physical acceptance remains required.

## Protocol and accounting

Set `sustainedTyping: { "chunks": 8, "intervalMs": 50 }` with the append
pattern. Bounds are 2–16 chunks and 10–250 ms between confirmed chunks. The
seeded plan includes every exact Unicode chunk and final operation marker.
Each editor types through its existing real input path: Playwright keyboard
input, WKWebView native text input or WebView2 `Input.insertText`. Both direct
file actors perform their normal filesystem writes concurrently with input.
They receive no sequence flag and cannot pretend to be keyboard actors.

Every chunk is at most 50 Unicode scalar values; the whole edit remains within
1024 values. Generated chunks are unique, include accented text and an emoji,
and contain one final ordinary role marker. The final semantic comparison
requires every chunk exactly once, every final operation marker exactly once,
and the unchanged original baseline. Chunks may interleave across actors;
requiring concatenated actor text would reject legitimate CRDT orderings.

There is one logical operation and one final `applied` event per actor/round.
Its `inputProgress` has the operation ID, contiguous one-based ordinal receipts,
exact chunk text, visible confirmation, monotonic elapsed milliseconds and a
confirmed `acceptedPrefix`. The coordinator rejects another actor's operation
ID, missing/duplicate/skipped chunks, early final acknowledgement, absent visible
confirmation, nonmonotonic timestamps or spacing shorter than the configured
interval. It also rejects unexpected progress on a direct-file operation.
The normal three-sample convergence and independent reopen gates still apply.

The existing native mailbox transports permit one reply per request, so the
receipts are returned together in that reply. They are not presented as live
streamed acknowledgements. Native actor event logs record each completed chunk.
The browser and native actors check the selected fixture and original editor
continuity around each chunk. No document, Y.Doc, checkpoint or save API is used
as an input substitute.

## Partial input and bounds

Before each input attempt, the actor retains the next ordinal and exact text.
A normal failure returns confirmed receipts and `acceptedPrefix` plus the
uncertain `attemptedChunk`, if any. The latter is not claimed visible or accepted.
The coordinator validates this prefix against the exact planned role, records
`input-prefix-failure`, stops mutation and preserves the failure receipt.
Subsequent chunks are not attempted after an input or visibility failure.
A process killed before replying can leave only its existing native event log
and production recovery journal; this slice does not claim mid-sequence kill
acceptance or infer unreported accepted input.

Actors check a shared 15-second monotonic sequence budget between input and
visibility operations. Existing bounded coordinator/relay waits still handle
an underlying browser/IPC call that does not return. Each chunk uses the existing
real input method and is observed before a receipt is added. No installer,
release, deployment, account change or background job is introduced.

## Checks

The full `node --test sync/stress/*.test.mjs` suite passed all 69 tests in
33.56 seconds: `/private/tmp/texttext-sustained-input-all-20261018.log`.
After tightening receipt interval validation, the four input helper tests and
four sustained coordinator tests were rerun separately:
`/private/tmp/texttext-sustained-input-helper-final-20261018.log` and
`/private/tmp/texttext-sustained-input-runner-final-20261018.log`.
These tests are explicitly simulated orchestration and mocked keyboard callback
proofs, with acceptance `none`. They do not prove native keyboard behavior.

The replayable `node sync/stress/input-sequence.browser.mjs` local driver fixture
passed in real Chrome 155.0.8059.84. Three chunks included decomposed combining
accent text, a ZWJ emoji sequence and Japanese text. The contenteditable received
six trusted `beforeinput`/`input` events with exact chunk data and final bytes.
A declared visibility-observation fault then stopped at 15018.6 ms after one
real attempted chunk, with zero confirmed chunks and the uncertain attempt
retained. Transcript:
`/private/tmp/texttext-sustained-browser-fixture-final-20261018.log`.
This is a headless browser driver fixture, not the deployed app or six-client
physical acceptance. It creates only an isolated browser context and closes it.

The root's Mac stress-flag compilation passed with
`swift test -Xswiftc -DTEXTTEXT_STRESS_ACTOR` and 40 focused helper tests
(one skip, zero failures), in
`/private/tmp/texttext-index-stress-actor-compile-20261018.log`.
The original `mac/Package.resolved` was restored by the root.
This compiles the private actor code but does not run a native typing journey.
Windows private actor compilation passed in the coordinated PC slot; see below.

## Follow-up attestation design

Use the existing uncached `/api/app/build` response for the serving web build
ID, together with hashes of the actual loaded UI assets and the current Oracle
`oracle-release.json` metadata (`commit`, `deploymentId`, lockfile hash and build
time). No new endpoint is needed. `/api/app/version` is a public Mac appcast
advertisement and cannot attest the loaded web build. The browser's current
hello includes a channel label, not an actual browser version; the next slice
must read the launched browser's version and retain it in coordinator evidence.
Expected source and artifact pins must be checked against what each actor
actually loaded, not merely echoed from configuration. See the capability
inventory in [runner preparation](2026-10-18-physical-runner-preparation.md).


The actual PC private `TextText.LiveAcceptance` project compiled in Release with
`BuildProjectReferences=false`, zero errors and one existing NU1510 package
pruning warning (2.13 seconds). Its missing restore assets were generated with
an actor-only `restore --no-dependencies`; Core and MainWindow were not rebuilt.
The previous private actor source was preserved before replacement. This was a
compile-only check, without launching the actor or modifying the installed app.

| Artifact | SHA-256 |
| --- | --- |
| Actor `Stress.cs` | `96178e183cb21ecc50ee8251948c517f38742004258366be57542d3882005507` |
| `TextText.LiveAcceptance.dll` | `179f73a207cc54697df6bb3e89431f3347d635340a5f32d021d710c658f099ba` |
| Referenced/copied MainWindow `TextText.dll` | `82895b95efd3d3c9c4c71ed32eda97bf91727da997b9ab40d2bef5ea84be5f4d` |
| Referenced/copied `TextText.Core.dll` | `99e84043f07c6f970129f2993ffe1304b426096e9d02d89c403b8281fb55eb1f` |

The referenced DLL hashes were equal before and after the actor build and
matched the DLLs copied beside the actor. Build transcript:
`/private/tmp/texttext-sustained-pc-build-final-20261018.log`.
Machine-readable compile receipt:
`/private/tmp/texttext-sustained-actor-dbe237d2-receipt.json`.
Private source backup:
`C:\Users\Shokunin\dev\texttext-delivery-65417abd\windows\TextText.LiveAcceptance\Stress.cs.pre-texttext-sustained-actor-dbe237d2`.
