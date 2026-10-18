# Mac 1266 installed check

## Source and delivery

Normal local Store-shaped build **0.204 (1266)** uses committed source `642ce9f421dcb88e6436c28d9a2c224cb16eb13a`. Mac and actual Windows independently verified **3,123 tracked files**, source SHA-256 `53f6a663e091e2397b1329fa356909ba226da7a17f591ef3c6157759120901aa`, archive SHA-256 `ec389c6e418d97d38bd88ce9f60c00df2fa0dabe17f61cd8982ed65a84ccf1ed`. Source remained exact before/after the build. Unrelated owner edits were excluded.

The full 22-check Mac release gate passed: 5,146 web tests (161 optional skips), 123 database tests and four scale checks, native tests, and required browser checks. Additional sync checks passed 252 Node tests and 1,016 tests (one optional skip). All twelve separately required conditional native actor tests ran and passed. App signature, arm64 app/three extensions, and eighteen isolated health checks passed. The official installer exited zero with runtime health passing and the nonblocking finder.provider warning.

Evidence: `/private/tmp/texttext-final-local-store-1266-642ce9f4-20261018/normal-local-build-receipt.json`, `/private/tmp/texttext-final-local-candidate-1266-642ce9f4-20261018.log`, `/private/tmp/texttext-normal-1266-install-20261018.log`. No public Mac release occurred.

The stable preinstall backup retains 2,401 vault files, 794 actual device-state files and the previous app (46 files): `PreinstallBackups/20261018-before-1266-checkpoint-diagnostic`, manifest SHA-256 `8f8fec46c51281bb9e261e72855fc0568af3c6e6ba9f5002b17581fe27f60d55`. Immediately before installation all three roots matched that backup exactly, the canonical app was stopped, and no writable handles remained.

## Actual installed result: FAIL

Normal launch reopened the prior recovered note with its exact title/body intact. Cmd-N created owned note `825f51a2-964f-47b9-bfeb-5cdcfc917fc9`, `Gallery/2.textpack`. Before any text input, its editor entered the generic recovery state. No accepted title/body input was lost in this check.

The supported Download recovery action exported the original failing checkpoint diagnostic: code `503`, message `Details withheld.`, generation 1, epoch 1, sequence 0, pending count 0, no batch, no unqueued dirty work, clean=true. This generic native code does not prove an HTTP response. The actual original exception is not yet identified. The app remains in recovery; no journal was reset or retirement bypassed.

Native generation-1 checkpoint and projection exist; the durable intent is absent. Current pack and native projected hash agree: `2c654bd84f4f1df0c35d5769e59d0c650fcf043d459e05d7a6c582ee1c8684d1`. A subsequent structural state read found no same-item full-pack outbox, conflict, binary outbox or lifecycle entry. That later read cannot rule out a transient earlier guard failure. Baseline acknowledged revision is `14728e833831ee0a2a20a0e4af9fd4e3707ba52c7c9180d6a077a80f0e116103`.

Evidence retained under `/private/tmp/texttext-mac-1266-installed-20261018`: screenshot, supported recovery JSON, exact original pack, native checkpoint/projection/before pack and bounded item structural state. Initial ordinary-use acceptance remains open. Next work adds bounded typed native failure classification; it does not change save behavior or claim a cause.

## Matching Windows candidate

Same-source normal candidate `candidate-61ceeb41e8114e2bb5c6e39fcbbdc20a` and private actor both passed and are sealed. Required checks include 24 private actor helper checks, 522 shared-client tests, native/TypeScript/UI/publish checks and actual isolated desktop close smoke. Receipt: `/private/tmp/texttext-pc-frozen-642ce9f4-ul1krl4_/completion-receipt.json`, SHA-256 `cec59b8275af1d2779b61de196e9890cafdc24cd249df7172bd3670a081d9eaf`.

Security audit 20:05:53–20:11:45 UTC found zero matching Shokunin login failures/lockouts; existing workaround remained present. Owner PID40636 remained responding in session1. No Windows installation, owner close or physical six-client campaign occurred.
