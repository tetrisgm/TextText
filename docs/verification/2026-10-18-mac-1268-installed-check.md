# Installed Mac 1268: zero-input handoff failure

## Candidate and installation

Normal local Store-shaped **0.204 (1268)**, source `35c726dd90328c7bf0428d2637f28250cec9f9c0`, was installed through the official installer. Strict signature, arm64 app plus three extensions, all 22 release gates, full sync gate and 18 isolated health checks passed. Runtime health passed with the existing nonblocking `finder.provider` warning. No public release occurred.

Frozen source: 3,148 files, input SHA-256 `204b24febad28218922738dfee36d196a91097c3a1b672c0d5606a7ef23abdde`, archive SHA-256 `2671f8cafa80129349faaa295c2819ca340973080575c04241202f39a7ac06f2`. The independent postbuild native run passed all 33 exact test methods with no skips, including the actual pinned old CLI refusal. The wrapper incorrectly expected a single aggregate33 line, while Swift reported two bundles of25 and8; its failed wrapper result is preserved separately from the verified passing test child.

Build directory `/private/tmp/texttext-final-local-store-1268-35c726dd-20261018`; build/installer logs `/private/tmp/texttext-final-local-candidate-1268-35c726dd-20261018.log` and `/private/tmp/texttext-normal-1268-install-20261018.log`. Exact native method verification: `native-handoff-33-verified.json` in the build directory.

Before installation, the new stable backup contained 2,502 vault files,854 actual device-state files and46 prior-app files. Backup `PreinstallBackups/20261018-before-1268-single-editor`, manifest SHA-256 `b594cc5e5018be2b04a4c9a33c6cb56ff18feb45e4309ac3512eb507b3171e34`. Current source snapshots still matched it immediately before installation.

## Actual failure

The app initially reopened the existing owned template-acceptance document. An immediate CmdN refused with “This workspace's account setup is finishing. Try saving again.” A later retry created an owned custom-gallery item. Its editor exposes cover controls but no Title/body, despite its blank-state hint; this is a separate unresolved template UI observation, not a handoff pass.

From Gallery, CmdN then created **`Gallery/6.textpack`**, item **`8dcf41df-a64c-4608-80c5-27bd3634ac52`**, Note template. No text was entered. The Title remained focused and editable, but native handoff entered a retained error with the same account-setup message and Download recovery. Thus installed zero-input acceptance **fails**; controlled input tests do not supersede it. No rapid-input or successful save/reopen acceptance was claimed afterward.

The supported recovery export contains local title ` 6`, empty body, and null draft,legacy backup and shared journal. Export SHA-256 `fa61502d0698fd0c870dbe51adce1bb1a0da8fc57781fe62dca25a8bb876946b`. Pack SHA-256 `7feda0317a56c6c4b4ad31c7d1918ede404790348fc49e798f53bec52ce5592f`. No user text was accepted in this fixture before failure.

The actual private profile is now version4 and owner version2; both exact files were retained. This installation **did perform live profile migration**. Do not run older apps against that upgraded state or overwrite recovery records. A later `lsof` found no holder and emitted an unrelated incomplete-SMB-inspection warning; it does not identify the transient holder at failure. The message maps to native profile lock contention; exact installed call/site and competing holder remain unproven.

Normal CmdQ then refused with the Keep editing save warning. The alert was acknowledged and the app left open; canonical PID8542 was observed. No force quit, reset, file deletion, account change or journal discard occurred. A future installation must first obtain a safe normal-close/recovery resolution.

## Evidence and next work

Private evidence `/private/tmp/texttext-mac-1268-installed-20261018` includes screenshots `initial.png`, `startup-account-busy.png`, `zero-input-custom-default.png`, `zero-input-note.png`, `normal-close-refused.png`; supported export `zero-input-native-handoff-recovery.json`; exact pack/profile/owner copies and their inventory. The export was saved through the native panel under a unique filename in the previous evidence directory and copied create-only into this directory; original preserved.

A separate isolated actual-relay test holding a stable shared profile lease reproduced typed `busy` on an already-published floor4. That is a bounded reproduction of the mechanism, not proof of the installed holder. Native no-op profile preparation and safe retained-session recovery are under investigation. Keep this installed failure linked to any later source fix and rerun with a new receipt.
