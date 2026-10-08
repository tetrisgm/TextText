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

## Follow-up server verification

`25e439c0` passed 470 core tests in 44 suites plus native gates
(`/tmp/texttext-sync-25e439c0.log`). The preceding run caught a stale exact
catalog expectation; no failed gate was shipped.

Oracle `texttext-oracle-20261008T053344Z-25e439c0` passed all 12 existing
production smoke checks. The generated archive retains the Yjs alias as a
relative symlink. On the live host, alias/canonical real paths and imported
Y.Doc constructors are identical; startup no longer logs duplicate Yjs.
Log: `/tmp/texttext-oracle-25e439c0.log`.

Expanded scratch smoke from `2b2503d6` then exposed HTTP 400 for create_folder:
the native route's allowlist still excludes the new command. This is an
integration failure requiring correction, despite the passing engine tests.
Log: `/tmp/texttext-folder-live-smoke.log`. No user document was involved.

## Folder route and template authoring deployment

Oracle `texttext-oracle-20261008T054121Z-ccf675f8` passed 13 live checks,
including the expanded empty-folder creation/retry/audit check. Frozen source
passed 475 core tests and native gates. Logs:
`/tmp/texttext-sync-ccf675f8.log`, `/tmp/texttext-oracle-ccf675f8.log`.

Installed CLI created Research note as template item
`889cf205-c18e-4a67-8153-4be1d2576c98`, then returned an identical receipt on
same-key retry. Its TextPack arrived on Mac, retaining template.json and
template-source.json, and appeared in the actual New from template picker.

Creating an item from it exposed missing starter text. The resulting dedicated
`Notes/Untitled 4.textpack` is saved as Research template verification 1183;
its body was not filled manually. This creation-flow defect remains open.
Template creation is not claimed fully accepted until that path is repaired.
