# Private Mac actor reader action

## Preserved first runtime failure

The sealed `a041398244964e627ef1a72681ea084310358c61` Mac actor opened the owned article but its hello failed: “Test reader did not expose its edit action.” Evidence: `/Users/shokunin/Library/Group Containers/52WM463HR2.group.app.texttext/NativeBootstrap1270-7ur443w7/result.json`, SHA256 `2263131c32e35be00ba09387cc97e97a2b376f3abc5cff73340f6b9109ff3a41`. The private bundle actually reported version 0.204/build 1270; its source seal and executable were verified before launch. No successful runtime identity attestation or editor-continuity claim followed the failed hello.

Only existing hello, prepare/observe intentions and shutdown were permitted; the first failed hello prevented the later observations. No edit, replay or close-probe was sent. Close-probe requires an actual accepted own edit and cannot qualify a read-only bootstrap. Shutdown acknowledged `ok:false`; the relay exited one and no TextText process remained. No force cleanup was used.

Actual document.json after the open exactly matched the final fixture snapshot: title, body and presentation unchanged. The real JPEG remained 53,704 bytes, SHA256 `ed06a94f6b494148666ddcc13727aa3912aa8b750dab26da7d3f50fa620c6baf`. Owner binding bytes were unchanged. Pack hash changed during the ordinary open (`59f29fd0…` to `d24c1d56…`); the harness did not retain the initial ZIP, so no entry-by-entry byte comparison is claimed. Post-open proof SHA256 `06232e7ddf04826f63ed4a5949517d99d07fb41f6a6c0a3119a27994b37fe809` in that evidence directory. The actual unauthenticated server build observation was still `texttext-oracle-20261019T021551274Z-4eca8353-1c86ff`, not a041.

## Source cause and bounded fix

`VaultStoryDisplay.tsx` renders a scoped button with text “Edit story” and no aria-label. `VaultNoteDisplay.tsx` renders the scoped aria-label “Edit card”. The private actor previously recognized only the latter. A real WKWebView regression using the production action markup reproduced article readiness false/body absent while the note passed.

The private, `TEXTTEXT_STRESS_ACTOR`-only helper now admits exactly one visible, enabled action in those reader scopes. An existing visible editable body returns ready without clicking. Missing, disabled, hidden, ambiguous and unrelated actions refuse. The surrounding selected-item, authenticated root/account, shared readiness, source identity and editor continuity checks remain unchanged. No renderer, fixture, signed candidate or normal product behavior changed.

## Focused verification

The old selector RED executed two tests with two failed article assertions; note passed. Log `/private/tmp/texttext-mac-reader-selector-red-20261019.log`, SHA256 `49b3ff73e6dde4200d875eff75ffbba124713944cf392019cbd07dc11baef38a`. An intermediate green attempt passed article/note/refusals and all prior actor tests, but its same-DOM fixture returned a DOM object across the WK bridge; that fixture-only failure is preserved at `/private/tmp/texttext-mac-reader-selector-green-20261019.log`, SHA256 `eba12c08465924cb216287894bdae304b75515f2fa6201edf622d7a8d34b3846`. Returning a boolean corrected the harness.

Final focused gate: **16 passed, zero failed, zero skipped**: four new real WK action tests plus all twelve existing private actor tests. This includes same DOM/no repeated click and seven refusal variants. Log `/private/tmp/texttext-mac-reader-selector-green-final-20261019.log`, SHA256 `1a297f8e6697608a57071ecf2980e7f6df6664c0a56900c641190a70e14c4022`. The exact owner Package.resolved bytes were restored in finally, SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.

This is source and controlled WK proof only. A new exact-source private actor executable must be built, signed, sealed and run before corrected standalone runtime acceptance. The installed normal a041 product need not be rebuilt for this conditional actor-only change. No six-client or guarded normal-window close acceptance is claimed.
