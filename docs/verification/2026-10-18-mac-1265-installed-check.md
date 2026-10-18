# Mac 1265 installed checkpoint

October 18, 2026. Intermediate installed candidate; normal new-note acceptance **FAILED**. This does not close T20, T21 or T26.

## Verified delivery

Source `55890b9cc8dbb672360c706455953a165b6258b6`; 3,100 tracked inputs, source SHA-256 `15e581ca2c785859dda04e3347673d0426634593504a64ed30508f6722cc8052`, archive SHA-256 `1705cae13aa972bed9326a64bb35ef65b409f7c3d0bceee6a99604cf6e9e69d7`. The genuine 22-check release gate, separate sync verification, ten actor-source tests and isolated normal-app health passed.

The official installer exited zero with required runtime health, strict signature, arm64 executable and three extensions. Actual `/Applications/TextText.app` is 0.204 (1265), executable SHA-256 `5879eb7a56580db012c8e0a3929f783fd0efabb1e72eba75d291368a27bd1174`. `finder.provider` remained a nonblocking runtime warning. No guard override, public Mac release or owner-root private actor launch occurred.

Before installation, fresh read-only checks proved the live vault, actual device state and prior1264 app still exactly matched the verified pre1265 backup, including source stamps. Backup manifest SHA-256 `450e54e8b7c20a574ad468955d028eddd83d6efd55721a811125a653ab39586f` remains retained.

The signed matching CLI was installed through a create-only version directory and atomic shim replacement. SHA-256 `60ae57f1ac231bf855a881599878e9814e405a1b3c74118548ed12687a054abd`; strict signature, arm64 and help passed. Previous `source-cd65ea30` binary remains. No authentication write occurred.

## Actual new-note failure

Normal CUA Cmd-N from Gallery created owned blank item `4d886e30-32c0-4d72-b228-b73db253e86f`, `Gallery/Untitled.textpack`. Initial Title focus appeared. Before the first attempted click, that AX reference became invalid; no title or body text was entered. The actual UI then displayed “This note needs to be reopened. Your edits are saved for recovery.”

Native checkpoint generation1 is clean: epoch1, sequence0, no pending update/batch, editing allowed, no retirement. The supported Download recovery export contains generation2 with the generic retirement, empty title/body, no pending update/batch and no unqueued dirty state. The normal Reopen file action refused with “Save or recover the pending edits before reopening.” This is an unresolved checkpoint/recovery failure, not evidence that accepted user text was lost. Its precise underlying error has not been established. No speculative save-path repair or manual journal clearing was applied.

A separate isolated title-promotion regression proved accepted title content survives while focus/caret are lost. That focus repair is future source and cannot explain or close this zero-input installed checkpoint failure.


## Supported recovery and reopen

The normal **Save a copy and reopen** action then saved the blank content as `Gallery/Untitled (recovered).textpack`, stable ID `f959b4fe-ea3a-44a5-874e-ebca79fbc0ad`, SHA-256 `5d478c7f573860eb4adcc804d069284e12c24dc9fb515c2070826d86dba9b2ba`. The original item became editable. Exact owned title/body input reached an independent authenticated CLI server read, hash `784aa9a21bbcbecfeb92ee9f2a44aeef8651db05bb06f97bae0efd2e5a1db18f`, and survived normal Cmd-Q plus independent canonical-app reopen. No recovery notice appeared on that reopen. The app was closed normally again before native verification.

This proves the explicit durable recovery-copy path and subsequent save/quit/reopen. It does **not** turn the initial new-note failure into a clean acceptance pass. Read-only source diagnosis also found why clean Reopen file refused: the session owner drains its save before the clean-journal preparation callback, and the checkpoint failure blocks that drain. Original underlying checkpoint code/message is absent from the captured records; a bounded recovery-export diagnostic is future work.

## Private evidence

- Install log: `/private/tmp/texttext-normal-1265-install-20261018.log`.
- Normal build receipt: `/private/tmp/texttext-final-local-store-1265-55890b9c-20261018/normal-local-build-receipt.json`.
- Owned pack, native checkpoint, supported recovery export and screenshot: `/private/tmp/texttext-mac-1265-installed-20261018/`.
- CLI build/install receipts: `~/.local/share/texttext-cli/source-55890b9c/`.
- Private actor original generated-cache refusal and subsequent frozen-source sealing evidence: `/private/tmp/texttext-private-mac-actor-1265-55890b9c-20261018/`. All six actual steps and ten archive-specific tests passed; only the exact generated `tsconfig.tsbuildinfo` was retained by rename, with before/after tracked inputs unchanged. The original refusal remains a failure record, not a fabricated standard-wrapper pass.
