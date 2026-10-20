# Mac 1274 installed save and reopen acceptance

Installed canonical `/Applications/TextText.app`, version `0.204(1274)`, source `56d144f7c9f017a68c713813ccbcc2145fa0002e`. Executable SHA256: `60aa171c629b51a0f5868353437c9f38a9467076f59905d1edd67fddfff72157`. The genuine candidate receipt passed all required gates, strict signature, arm64 app/extensions and 18 health checks (receipt SHA256 `9122c6f03c2c5e849f877179a89410ef6e5448e05cf24302f64f96927474a6a9`). Supported `install-local.sh` passed with default runtime health enabled; `finder.provider` was a nonblocking warning.

## Preservation and delivery

Old 1273 PID62119 refused normal Quit on its failed-open recovery screen. The original pack, supported recovery copy and UI session export were rehashed against the preserved proof. Only then was the explicitly authorized maintenance TERM used. This stop is **not** counted as successful normal close.

A complete stopped backup preserved the old app, vault, entire device state and opaque credentials: `~/Library/Application Support/TextText/PreinstallBackups/20261019-before-1274-56d144f7/manifest.json`, SHA256 `fcad8f1ca4e63b3bdd5d4a9a9d90d7cd48ad608ecef84a8888e1f30fbf978856`, 284,916,940 bytes, exact before/after/copy inventories.

The actual unfiltered candidate Release CLI was signed with the existing Apple Development identity, verified strict/arm64/help and installed through its supported `install` command before the new app launched. Target: `~/.local/share/texttext-cli/source-56d144f7/texttext`, SHA256 `f44b331112196828706885322dfbabc2778a2d152b5ea55f6c86d291092c6732`. Previous 4f binary and original shim remain preserved.

## Actual normal UI acceptance

The exact previously blocked article `7ba1c77c-f4b6-4725-814e-4f20252e2063`, `Notes/Six-client acceptance mixed 1273 20261019 d6f52401-7ba1c77c.textpack`, opened with its original text/JPEG and Edit story, without the recovery error. Through the normal editor, a new text marker was entered, `public/fixtures/content-first/square.jpg` was imported using the native picker, and a second marker was typed after the editor reopened. The original image remained; the new image is `square-2.jpg`.

Three normal CmdQ/absence/fresh-reopen cycles passed, with no maintenance signal:

- PID81070: original article plus fresh image and text; fresh PID81753 rendered both markers and both images.
- PID81753: new normal note `64069cf7-15f0-4e86-9c75-3caa75bb7687`, `Notes/Untitled 22.textpack`; fresh PID81993 rendered the exact title and nonempty body.
- PID81993: original article reopened through its registered Finder file handler, normal Quit, then fresh PID82443 rendered exact text and both images again.

The final app is left open on the healthy original article. Screenshot: `/private/tmp/texttext-mac-1274-56d144f7-installed-20261019/final-article-window.png`.

Fresh authenticated read-only hosted checks matched both complete DocumentSnapshots and asset inventories. Article hosted revision: `a54e8e625595942c70443e8231b31bdb92d256bcc195147cee7a384ea78cafaf`. Both JPEGs are 53,704 bytes, SHA256 `ed06a94f6b494148666ddcc13727aa3912aa8b750dab26da7d3f50fa620c6baf`. Note local/hosted raw pack matches `0d38ec0c2f9e4f1197fe2fa0832947068994aafcb87363a88ec1c2ac74bdb58b`. Article raw archive hashes differ while full snapshot and JPEG bytes match; the initial overly strict raw-pack comparison refusal is preserved, not treated as a product failure or hidden.

Private evidence: `/private/tmp/texttext-mac-1274-56d144f7-installed-20261019/` (install log, normal-cycle receipts, final-runtime.json, article/note-hosted-v2-proof.json, screenshot). CLI evidence: `/private/tmp/texttext-release-cli-56d144f7-prep-20261019/installed-receipt.json`. No public release, content reset or unrelated process stop occurred.
