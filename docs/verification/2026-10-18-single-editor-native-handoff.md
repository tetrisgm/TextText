# Single mounted editor during native collaboration handoff

Source verification only, 2026-10-18. No installed-app, physical fleet, or release acceptance claim.

## Reproduction and scope

The controlled production-VaultApp reproduction held native opening while a local editor was promoted. The previous inert surface let trusted `n` reach the global new-note shortcut and attempt a second creation. The fixture refused that creation. Accepted text before the transition remained present. This establishes the controlled mechanism, not the exact cause of every installed observation in [the 1267 receipt](2026-10-18-mac-1267-installed-check.md).

The repair keeps one mounted editor and awareness surface. Its existing local draft remains the input owner while already-issued file work drains. New direct file work stops before native opening. Two bounded transfers persist exact Yjs updates before applying them; each transfer waits for its actual journal generation and captured lifecycle. The final document, mutation callbacks, selection, and owner switch synchronously. Later shared input is journaled by the shared owner. A draft is removed only after its exact transferred generation has a native durability receipt.

Unknown opening, storage, account, conflict, and durability outcomes retain the view, draft, and native handle. They do not resume the file writer. Navigation, publication, and close remain blocked until the retained handoff is acknowledged. Recovery download includes the retained local document, exact draft/legacy bytes, and the shared journal when a client exists.

## Durable format and compatibility

Native-only draft v2 contains at most two exact encoded Yjs intents, their SHA-256 digests, source snapshots/generations, and account/origin/workspace/item/epoch scope. Existing update-size limits apply to each intent; the total record is bounded to 4 MiB. Legacy draft bytes are retained create-only under a content-addressed companion key. Invalid, future, oversized, changed-owner, and third-intent records refuse before application or replacement.

Config support is not upgrade proof. The new path requires `localFiles:true`, an advertised version-1 capability, and actual native-open proof that private profile floor 4 was published. Unrequested opens keep their previous format. Unconfigured state and state inside the vault cannot publish this floor. The floor affects known older readers of the **same actual private state base**; it does not fence the CLI's separate private base, other devices, already-running old writers, or historical readers that ignored profiles. No shared workspace or TextPack schema changes.

Ordinary web creation does not enter this native transition: a delayed config/baseline fixture exposes no editable surface until its remote owner is ready. It writes no native handoff record and retains the existing IndexedDB schema.

Restart applies the same recorded Yjs bytes. It never rediffs the original snapshot against a later inclusive remote state. The concrete `Hello` → `Hello L` → peer `Hello L R` restart fixture preserves `Hello L R`, without a duplicate operation, direct file write, or epoch reset.

## Verification

- Controlled Title/body input at native-open, baseline, and checkpoint waits passed. Continuous Title/body fixtures proved shared commit while trusted typing remained in flight, with the same DOM node and exact final text.
- Title caret/backward selection and focus moved to another control passed. Existing body/focus regressions are retained in the verifier.
- CDP composition passed with trusted composition-start/accepted-input and a Chromium-generated untrusted end event. This is not physical OS-IME acceptance.
- Image paste and Save as look refuse before new file/asset work is accepted during handoff. Article capture begun before the pause drains first. A real duplicate background capture RED was repaired; the final capture fixture makes one extraction and retains concurrent text plus captured fields.
- Reader mode does not acquire a native lease without an editor surface. Actual article Done → Edit story triggers handoff without a second sync event.
- An already-issued local save is held while newer trusted text is accepted. Native opening waits, no second direct save starts during the pause, and the newer text transfers exactly.
- Registered client gate: 52 files, 588 tests passed, no skips, including the complete collaboration client and five new pure contracts. TypeScript passed. Verifier registration tests: 11 passed, no skips. The native source gates and exact old-reader characterization are in [the native floor receipt](2026-10-18-native-local-handoff-floor.md): Mac 33 tests with no skips; Windows 1,104 Core checks, 106 bridge checks, 15 focused checks, and WPF compilation passed.

All 28 registered controlled browser scenarios passed: 20 passed in the final matrix, the body-IME case passed after correcting its assertion to inspect the selected body rather than Title, and the remaining seven passed in the final tail. The failed body-IME assertion did not indicate a product failure: its preserved probe already showed the expected trusted composition and text. No product change was made for that harness correction.

The uncertain-checkpoint client test initially assumed a fixed order for genuinely concurrent insertions. It now compares the exact merge of the captured Yjs states and separately verifies both insertions occur once. The causally acknowledged-transfer-plus-peer-append test still requires exact `Hello L R`.

Primary private logs:

- `/private/tmp/texttext-native-handoff-registered-client-final-verified-20261018.log`
- `/private/tmp/texttext-native-handoff-final-frozen-tsc-20261018.log`
- `/private/tmp/texttext-native-handoff-verifier-final-20261018.log`
- `/private/tmp/texttext-native-handoff-final-browser-matrix-20261018.log` (first 20 pass; original harness failure retained)
- `/private/tmp/texttext-native-handoff-final-ime-body-corrected-20261018.log`
- `/private/tmp/texttext-native-handoff-final-browser-tail-20261018.log` (seven pass)

The exact combined source/hash inventory is `/private/tmp/texttext-single-editor-handoff-final-source-20261018.json`. All original failure logs remain preserved. No failed check is presented as a passing whole invocation.

## Remaining acceptance

Build and install a coherent reviewed candidate, repeat rapid new-note typing through the real native bridge, and verify normal save/quit/reopen. Preserve the separate installed checkpoint-failure evidence; this source change does not prove its cause or claim it repaired every previous generic error.
