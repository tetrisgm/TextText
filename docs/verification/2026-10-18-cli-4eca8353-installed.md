# Local CLI 4eca8353 installed

The owner-reviewed signed local CLI now matches source `4eca8353f455d5960e5c4cd592bece0aefff70fa`. The normal shim `~/.local/bin/texttext` points to `~/.local/share/texttext-cli/source-4eca8353/texttext`, SHA256 `b5cc25c4e6f5b3cb7db12ca790eef9c1f9579c105104f6759ae8bbe0cad947f6`. Signature, arm64 architecture and help checks passed. Installation preserved the previous shim copy and all older targets.

## Build proof

The CLI was built from the verified normal1269 archive, not dirty main. Executable wrapper Git blobs were checked before import. Source before/after: `e100bcf09a1bc9c689ba62610ea88f3aa01328a1563a0497b1c276f577f650f2`, 3158 tracked files; source archive SHA256 `97985bbecf11b4b8b516fb8739a1d5e5b3c851e649f7606b49c1b720c7adc512`.

Command: `swift build --jobs 2 -c release --triple arm64-apple-macosx14.0 --package-path mac --disable-automatic-resolution --product texttext`. The archive Package.resolved was restored exactly in finally, before/after SHA256 `5e58a977a9ea432d7459bcddc420b827f3b32caba57afcc40a3d0fc358af627e`. Normal app artifacts remained unchanged. The copied executable was signed with the existing Apple Development identity and strictly verified; help used an explicit disposable CLI state directory and wrote no state.

Build evidence: `/private/tmp/texttext-release-cli-4eca8353-20261018/release-cli-receipt.json` and `swift-build.log`. Installed `build-receipt.json` and `install-receipt.json` are retained under `~/.local/share/texttext-cli/source-4eca8353/`.

## Independent readback and limits

The supported hosted read of owned item `8561b2e6-9f49-4420-b4f3-cff9d1f89542` exited zero with hash `96c0674302da9f1ab74b5699bd1acf8519086540b1188a2f39fc39a581febcd7`. Independently comparing saved baseline `read-uuid.json` with `read-uuid-updated-cli.json` in `/private/tmp/texttext-mac-1269-cli-convergence-20261018/` confirmed exact item ID, hash, document and markdown equality. This is hosted read convergence, not a local-file write or six-client acceptance result.

Build and installation performed no authentication mutations. The normal authenticated read may renew credentials through existing runtime behavior; no explicit authentication change was requested or performed. The pinned previous CLI at `/private/tmp/texttext-release-cli-55890b9c-20261018/texttext-release` remains unchanged, SHA256 `60ae57f1ac231bf855a881599878e9814e405a1b3c74118548ed12687a054abd`, preserving the [old-reader compatibility proof](2026-10-18-native-local-handoff-floor.md).
