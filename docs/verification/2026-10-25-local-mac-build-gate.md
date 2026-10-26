# Local Mac build no longer launches the full sync suite

An October 25 local Store-shaped build for `a436a6b8` exposed the old build script's automatic `sync/verify.mjs --check || sync/verify.mjs` fallback. With no current receipt, it launched the historical full stress suite before compilation. That run was stopped; its child test process was also stopped. The owner's `mac/Package.resolved` stayed at SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.

Both Mac build entry points now leave source checks to the change being built. A single local retry compiled Swift, assembled the app bundle, and generated App Intents metadata without launching the sync suite. The assembled build 1282 contains no `Helpers/codex` or embedded-agent version key. It reached code signing, which failed with `errSecInternalComponent`; the login keychain reported `User interaction is not allowed` over SSH. This is not an installed acceptance pass. The partial candidate was retained at `.texttext/candidates/unsigned-1282.app`, and the previous candidate was restored to `mac/build/TextText.app`.

Mac checks: `bash -n` for both edited scripts and six focused app-capabilities tests passed. One signed build and installed open/edit/save/quit/reopen check remain pending keychain access. No installed app, journals, or user files were changed.
