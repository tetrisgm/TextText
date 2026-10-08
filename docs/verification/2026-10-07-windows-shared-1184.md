# Windows shared client acceptance, 1184 cohort

Source `98bb52b5`, clean archive in `C:\Users\Shokunin\dev\texttext-verify-98bb52b5`.
Installed source fingerprint:
`8b723ed9c5e86b97c3ffa40ffebf4fa38f099a351aae28b9e730135ac930cdd3`.

## Build and installation

Pinned runtime bootstrap, native file/sync and agent regressions, 215 shared
client tests, TypeScript, bundle/publish and actual WPF/WebView desktop smoke
passed. Candidate: `windows/build/candidate-ba8be29c13d84b24bc78548ca781bb4e`.
Smoke: `windows/build/smoke-receipts-7d85bf025c4f495cb98d0f0de37a3a55`.
Complete build log copied to Mac `/tmp/texttext-build-98bb52b5.log`.

Installed after normal window close through the renderer flush guard; both
candidate and staged hashes verified. Prior app retained at
`%LOCALAPPDATA%\Programs\TextText-previous-20261007T231820-aab1060d`.
No forced termination, login change, or workspace relocation. Temporary
interactive acceptance tasks were unregistered. No recurring job installed.

## Actual installed UI and persistence

Existing signed-in reader reopened. Real Home > New from template > Research
note creation loaded the current version-two starter, including Findings,
Questions, Sources and Next steps. Dedicated new item `Windows template
starter verification 1184` retained all four headings plus exactly one each
of `Windows starter search marker 1184.` and
`Windows cache freshness marker 1184.`. Native disk inspection confirmed the
saved body. Search for the second edit found the item in 357 ms. Normal close
and relaunch reopened the saved body in 1.224 s. Native outbox was empty;
existing account and workspace root were retained.

Acceptance automation initially expected built-in note controls (Finish and
an Edit search field). The custom template correctly exposes Save, which
keeps editing, and the search control has a different UIA type. Selectors were
corrected against observed UI; no duplicate verification item was created.

## Bounded performance evidence

Normal-priority interactive launches, UIA polling every 250 ms:

| Launch | Window | Existing document ready |
| --- | ---: | ---: |
| First after install | 821 ms | 1,568 ms |
| Warm one | 456 ms | 1,190 ms |
| Warm two | 462 ms | 1,146 ms |

Over 30.6 seconds immediately after the final launch, seven-process tree
working set ranged 551–596 MiB and ended at 585 MiB; private memory ranged
338–366 MiB and ended at 349 MiB. Aggregate CPU increased 5.95 seconds.
This includes startup settling and shared WebView pages; it is not a
long-duration leak test or a steady-state idle-network measurement.
Previous performance context: [1183 acceptance](2026-10-07-windows-shared-1183.md)
and [file-vault measurements](../file-vault-performance-2026-09-30.md).

Transient recovery evidence comes from the production collaboration-client
and manifest deadline regressions included in this candidate. No live network
outage was injected into the user's session. PC receipt files in
`windows/build`: `installed-acceptance.json`, `template-live-result.json`,
`startup-timing.jsonl`, `save-reopen-timing.jsonl`, `idle-process-samples.json`.
The app remains running on the saved dedicated verification item.
