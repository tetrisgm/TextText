# Current verified delivery

Source e722c893. Full exact-source sync gate passed (87 test files, 848 tests,
TypeScript and native file/durable sync regressions). Log
`/tmp/texttext-e722c893-sync.log`. Web-only dry-run verified immutable archive
`/private/tmp/texttext-delivery-e722c893/.texttext/oracle/texttext-20261009T004717Z-e722c893.tar.gz`.

Oracle deployment through release/ship.sh passed its authenticated document,
audit, deletion/restore and pre-restore fencing checks. Public /api/app/build
reports texttext-oracle-20261008-e722c893-backlinks. Previous release retained.
TextText and three Algorave units active; HAProxy mtime unchanged. Log
`/tmp/texttext-e722c893-deploy.log`.

Mac 0.204 build 1222 signed, verified and installed at /Applications/TextText.app.
Actual native UI reopened signed in, real iCloud workspace, existing Parent
verification note and its saved Cache1221p7m4 body intact, no recovery controls.
Build first failed because invoking the already sandboxed installed Codex helper
for --version crashed. The signed standalone runtime at ~/.local/bin/codex
(0.153.4) succeeded; packaging/signing retry passed. Logs
`/tmp/texttext-mac1222-build-retry.log`, `/tmp/texttext-mac1222-install.log`.

Windows verified e19d53c3 candidate installed on owner's explicit stop/reopen
authorization. Temporary interactive launch task removed. Canonical process
18184 runs in desktop session 1. Affected item 273adce8-01cb-4934-8079-c0397efc82a3
checkpoint now epoch 2, Pending false, RetiredReason null; prior checkpoint
archived automatically. This proves refresh of stale native state, not visible
banner disappearance or edit acceptance. Those checks remain.

Owner enabled Mac share permission. Fresh Safari Share menu still omitted
TextText although pluginkit lists installed app.texttext.mac.share. Actual
capture unverified; no permission was changed by this verification.

## Follow-up share acceptance

Explicit owner-authorized PlugInKit use election exposed TextText Share in
actual Safari on Mac 1222. Native share form loaded New bookmark, received
public URL https://example.com/?texttext-share=1222 and title Safari share
verification 1222, and closed after Post. Native command search and independent
iCloud path search found no created file. A normal restart did not resolve it;
local CLI search also returns an empty result. Do not claim end-to-end capture.
AppDelegate.drainShareInbox still uses cached legacy Workspace folder metadata
and ServerClient.postFile, rather than the local file command path. This is a
lead to investigate, not a proven cause. Group container inspection from the
terminal was denied; no privacy bypass or credential logging was attempted.
