# Bundled native editor offline acceptance

Both `LocalVaultWindowTests` passed (1.828 seconds). Command:
`TEXTTEXT_STORE=1 TEXTTEXT_VAULT_HTTP_TEST=1 swift test --package-path mac --jobs 2 --filter LocalVaultWindowTests`.
Log: `/tmp/texttext-current-editor-smoke.log`.

The earlier smoke expected the removed folder-connection sign-in message and
editing without an account. Its subsequent synthetic account still lacked a
verified workspace binding and cached permissions, so the editor correctly
remained read-only. The fixture now represents an already authorized workspace:
temporary binding, synthetic account, cached edit permission, unreachable
loopback server. No real token or account is used; product authorization is
unchanged.

The WKWebView integration opens an actual TextPack, enters the editor, saves a
body edit, then observes an atomic direct ZIP replacement made outside the
app. It checks resulting content and retains the file URL. The separate empty
account-folder check confirms selecting a folder does not seed local documents.

This is native integration evidence, not a new installed build, a real-account
authentication test, physical iCloud delivery, or cross-device certification.
