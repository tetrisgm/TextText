# New note command and focus boundary

## Controlled observation

A disposable Chromium fixture used production VaultApp and the native `texttext:vault-new` event, holding the second native create reply. The existing editor became inert while the command was busy. Trusted `nabc1269` keydowns then targeted no Title input: there were no corresponding `beforeinput` or `input` events. The old item remained unchanged. After releasing creation and observing the new Title focused, trusted ` after-focus` typing proceeded in order and persisted exactly as `New after-focus`.

The diagnostic assertion that all command-following keys should become `Newnabc1269 after-focus` failed as expected. This characterizes a pre-focus interval, not loss of text accepted by the new editor. It does not reproduce old-item corruption or reversed input. Fixture/page errors were empty and all owned browser children closed.

Final log: `/private/tmp/texttext-native-create-command-input-contract-red-20261018.log`. Exact event order and snapshots: `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-create-command-qbnHWK/observation.json`. Earlier attempts retained fixture-only setup failures (invalid projection/newlines or empty TextPack builder name); the final observation uses coherent packs and the actual write path.

The unregistered diagnostic was retained by exclusive same-volume rename outside the repository at `/private/tmp/texttext-mac-1269-installed-20261018/diagnostics/verify-native-create-command-input.mts`, SHA256 `8b71c853b878d27e53bba861c0c928f67beffa8dd63a237179971a644a4c1931`. Its original path, inode and exact hash are in adjacent `create-command-fixture-retention.json`. It is not a required passing suite and no product repair was made.

## Native and installed boundary

Mac `newDocument()` emits the event through WKWebView `evaluateJavaScript` with no completion handler. Its return does not acknowledge receipt of the JS command or readiness/focus of the newly created Title. Creation also awaits the previous editor flush, folder defaults and native create/import reply before selecting the new file.

Installed 1269's batched CUA command plus typing separately changed old Gallery/7 to a reversed-prefix title while Gallery/8 remained blank. Evidence is retained in `/private/tmp/texttext-mac-1269-installed-20261018/{zero-input-note,immediate-command-input}.{png,txt}`. The controlled test awaited actual create-pending and therefore examines a later boundary. It neither reproduces nor explains the installed CUA scheduling/order observation. Actual native after-focus typing remains a separate installed check.

## Contract and possible scope

[Ordinary-use acceptance](../plans/shared-app-finish-checklist.md) specifies create, type title/body, navigate, normal close and independent reopen. T25 specifies measured typing and usable-open latency. Neither explicitly requires preserving keys sent before new-editor focus; [DESIGN](../../DESIGN.md) does require a new note to focus writing immediately. This diagnostic is not an accepted-input durability failure or a passing latency measurement.

A minimal follow-up can define and measure command-to-focus readiness and verify exact input after focus. Preserving earlier typing would require one synchronously mounted pending-item editor with actual IME/paste/selection semantics, a durable account/root-bound creation intent and stable item identity, idempotent native creation/lost-reply recovery, explicit cancel/error retention, and the same DOM through creation and shared ownership. These changes are not implemented. A global keydown character buffer would not establish those guarantees.
