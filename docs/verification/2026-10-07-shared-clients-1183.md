# Shared clients, Mac 1183

## Verified source

Product commit `04c265c7`. The frozen source at
`/private/tmp/texttext-shared-XdMxA6` excludes unrelated working-tree edits.
The mandatory sync gate passed 457 tests in 43 suites, TypeScript and native
checks. The final Windows bootstrap change leaves both recorded gate input
fingerprints unchanged, confirmed by `node sync/verify.mjs --check`.
Log: `/tmp/texttext-final-24d3c207-sync.log`.

## Mac installation and acceptance

Installed `/Applications/TextText.app` version 0.204 build 1183 through the
existing local installer. Code signature, arm64 executable, three extensions
and embedded Codex validation passed. The sandbox-private runtime report was
not attested; the established development-only installer exception was used.
Logs: `/tmp/texttext-mac1183-build.log`, `/tmp/texttext-mac1183-install.log`.

The app was in saved reader mode before normal quit. Account and iCloud root
were retained. Actual installed UI showed the existing note, icon and body,
and the new text-template picker. A dedicated note received
`Shared client verification 1183.`; search immediately found that new body
text, and normal quit/relaunch retained it. Reading the TextPack confirmed
exactly one occurrence. No recovery banner appeared.

Only test item `290afb22-c198-4a7f-9d26-9a4f04dd9020` was edited. The existing
125-second picker and unaffected performance tests were not repeated.

## Oracle and live web

Web-only release `texttext-oracle-20261008T052428Z-04c265c7` deployed through
the verified Mac release path. All twelve production HTTP checks passed,
including canonical writes, durable retries, deletion/restore and epoch fencing.
Log: `/tmp/texttext-oracle-04c265c7.log`. TextText and all three Algorave services
are active; shared proxy and runtime configuration mtimes are unchanged.

Actual Safari retained the signed-in account and passively received the Mac
marker. After deployment/reload, Settings displayed the shared account and
provider configuration UI. No web provider is configured, so no real provider
call or live model-generated approval is claimed. Mocked browser coverage
certifies those transport/control paths only.

Startup logged a duplicate-Yjs import warning. Investigation is in progress;
the successful smoke checks do not dismiss that packaging risk.

## Pending acceptance

Windows acceptance passed: signed-in startup, search, snippet save/insert,
Finish/reopen and passive receipt of the Mac marker. Outbox/conflicts were zero.
[Windows receipt](2026-10-07-windows-shared-1183.md).

The packaging fix `3de70287` reproduces and prevents duplicate Yjs constructors
in the actual Oracle package layout. It is committed but not yet deployed.
Canonical folder creation `48080f86` passed 34 focused checks; the combined
mandatory gate is running before deployment.
