# Mac 1267 installed check

## Build and installation

Normal local Store-shaped Mac **0.204 (1267)** uses source `090388f3abc311f4d7dbcdff5e32d807ad3f4c59`, adding bounded native checkpoint classification without changing save/recovery behavior. Exact before/after proof: 3,127 tracked files, source SHA-256 `d76a16dc275da1069eaa0e742cde06726be05e801f5d75e48ac2e6efd5d7bb66`, archive SHA-256 `0f4bf6fcbf5ea60ae6d6492d5f086a32c6ab790107d152370cc02b3ab9e21b41`.

Full release gate passed: 5,149 web tests (161 optional skips), database/native/browser checks. Additional sync gates passed 252 Node tests and 1,019 shared-client tests (one optional skip). Twelve required conditional native actor tests ran and passed. Signature, arm64 app/three extensions and eighteen isolated health checks passed. Official installation/runtime health passed with the nonblocking finder.provider warning.

Fresh stable backup: `PreinstallBackups/20261018-before-1267-native-diagnostic`, 2,425 vault files, 808 device-state files and previous app (46 files), manifest SHA-256 `f5fef458e2b58a5cfdc29e801ba9de9d56858adef8cb779eab66d13b1bde4173`. All roots exactly matched immediately before installation; app stopped and no writers. The previous1266 failed blank note was preserved through supported Save a copy and reopen: `Gallery/2 (recovered).textpack`, identity `19caf306-312f-4c0f-8836-45f6286a43fb`, SHA-256 `2f5ce84be2a618b7004fd3417cd53fb4b79edbca71a4fabcd9fd336718c170ff`. No journal reset or bypass occurred.

Build/install evidence: `/private/tmp/texttext-final-local-store-1267-090388f3-20261018/normal-local-build-receipt.json`, `/private/tmp/texttext-final-local-candidate-1267-090388f3-20261018.log`, `/private/tmp/texttext-normal-1267-install-20261018.log`. No public release occurred. The later Apple callback fix is not in this installed source.

## Actual ordinary-use results

- Fresh note `a638358e-c96a-49e5-b299-ca8dad20cf5b`, `Gallery/3.textpack`: remained editable through promotion. Title `Installed Mac 1267 acceptance` and body `Installed Mac 1267 preserves this exact owned body through save and reopen.` matched an independent authenticated server read, hash `38b87a05137e36b0c715b562860593c7166df79b0243166ae05773f521f7a56c`. Normal Cmd-Q exited; independent canonical-app reopen displayed exact content without recovery.
- Second fresh note `dcd8cd87-3f1b-4a64-9e43-2cb49b2c9391`, `Gallery/4.textpack`: promotion retained title focus, then typed title/body matched authenticated server read, hash `862358f305c1309e0e7603b213dfb3c85185b2d71b426e2b7c606e69c06c8e81`.
- The zero-input checkpoint failure did not recur in these attempts. Its original cause remains unresolved; no diagnostic-only source change is claimed as its fix.

## Actual rapid-input result: FAIL

Cmd-N created third note `f04d98c8-ffb7-493c-a248-171537f47932`, `Gallery/5.textpack`; AX reported title focused. The next computer-use call sent Cmd-A and typed `Installed Mac 1267 rapid title`. Result: navigation to a new blank `Notes/Untitled 19.textpack`, identity `8fd724d9-359e-4b01-a93b-ccb170eed359`; intended title was not observed in either saved note. This proves an unexpected input/navigation result, not loss of text previously accepted by the editor or a proven native event ordering.

Both exact packs and the screenshot are preserved under `/private/tmp/texttext-mac-1267-installed-20261018`. Investigation is testing whether temporary inert/blur during promotion exposes global bare-letter shortcuts; existing focus tests pause input during inert and do not prove this interval safe.

The unexpected blank test note was subsequently explicitly edited to `Installed Mac 1267 rapid input recovery` with body `Owned acceptance note retained after the rapid-input focus failure.`; authenticated server read matched exactly, hash `cd40623e661037a1b04f869c11769d63c080db5168f1432f4595c43b602ce32f`. The app quit normally afterward. No test notes or earlier failure evidence were deleted. Overall installed acceptance remains open.
