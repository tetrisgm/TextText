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

## Pending acceptance

Windows candidate checks passed; installed acceptance is in progress.
Oracle web-only deployment is in progress. This receipt does not yet attest
either installation or the live new web assistant/provider flow.
