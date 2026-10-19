# Shared editor file-mutation handoff

## Reproduced boundary

Installed Mac 1271 imported the owned image into its canonical pack, then retained the previous clean editing projection with a generation-2 checkpoint error: `The local shared file session has closed. Your journal is kept.` The supported recovery-copy action preserved the previous projection and reopened the original image pack. Private evidence is `/private/tmp/texttext-mac-1271-installed-20261019/image-import-state-proof.json` (SHA-256 `5cbdf5fe6f9a4ac51b3c1d1837aa1224c622ca19a5ff427a34b0bc83e1af407f`) and `supported-recovery-copy-proof.json` (`f0abf2b2ce24402fbd7d061814e358d52e69f7cd081e572fea0bada5b74ab9c3`).

A controlled production `VaultDocumentSession`/`SessionOwner` reproducer confirms close-native → projection-changing write → `vault-changed` can enqueue a checkpoint through the old callback after its native lease closes. The later reset drain refuses safely. An archive of the previous production component also fails to reopen under the same controlled paste/write-event ordering. A hash-only file change control passes. These paths predate the current candidate; this is not attributed to an unrelated recent change.

## Change

Image paste and applying a look now finish the existing owner’s save, durable clean-journal removal and close **before** their external CAS write. Exact view, source, client, snapshot and journal-generation checks refuse changed ownership or late input. The owner keeps its closing map entry through the entire exclusive write, preventing another acquire between close and CAS; success, failure and unmount release only that exact terminal entry.

Checked reread and replacement-session readiness happen after the exclusive operation releases its tombstone. A scoped waiter binds the item/account/root view and generation; stale rereads cannot update a different selection. The input surface stays inert until the newly bound editor is committed. A temporary capture listener consumes plain typing/edit keys during this interval so they cannot become global bare-key shortcuts; modifier/system shortcuts retain their behavior. Listener cleanup is idempotent, including failures and unmount. Failed reopen removes the destroyed editor before exposing recovery/retry controls and never returns a successful image caret.

Save-as-look remains a create-copy operation. Supported recovery still requires its durable copy proof, then exact retirement cleanup and close; it does not use the ordinary clean-file mutation proof. No native checkpoint guard, native journal format, transport authentication or storage ownership rule is relaxed.

## Verification

- Frozen scratch required client lane: **742 tests pass**, 0 skips; registration checks **17 pass**; nonincremental TypeScript passes.
- **11 controlled Chromium scenarios pass** using production editor/session/owner code: native and hosted image paste; applying a look; rejected and lost write replies; failed reread with supported retry; actual VaultApp bare-`n` during held write and replacement baseline, followed by accepted ordinary typing; changed item and unmount during held reread; supported recovery copy and failed-copy zero retirement. The clipboard event is synthetic with a real generated PNG; subsequent keyboard input is trusted Chromium input. This is not WK/WebView2 or installed-app acceptance.
- Owner exclusion has a meaningful two-test RED → GREEN. The exact plain-input listener lifetime is checked across **25 unit cycles**, including modifier pass-through and no listener remaining after cleanup. A first required Node 22 run exposed its boolean-capture removal behavior; using the same explicit capture-options object for add/remove passes the final lane. Original failures and fixture-preparation refusals are retained.
- Main copied bytes match all ten frozen source/test/registration hashes. Main focused owner/handoff checks **48 pass**, registration **17 pass**, and nonincremental TypeScript passes. No native compiler, installed app action, account operation, release or deployment is part of these source checks.

Exact logs, before/after source hashes and process results: `/private/tmp/texttext-file-mutation-handoff-iozax_g0/final2-gates.json` (SHA-256 `5a712208e135691861ca08d5645d378ac102a2fdc184fb93a34f2e2c3e6955f6`) and `main-gates.json`. The former records all fourteen commands and unchanged source hashes. Prior REDs are `component-old-red.log`, `owner-red.log`, and `final-client.log`; the minimal closed-callback RED is `/private/tmp/texttext-native-asset-source-r211ruoa/closed-native-reset-write2-red.log`.

[Installed Mac1272 acceptance](2026-10-19-mac-1272-image-template-acceptance.md) now passes actual image import, subsequent typing, template changes and normal quit/reopen. Its final rename check exposed a separate path-convergence failure, preserved in that receipt; this does not receive a rename pass. Existing1271 failure and recovery evidence remain historical. The separate disabled native asset observer scratch is not included.
