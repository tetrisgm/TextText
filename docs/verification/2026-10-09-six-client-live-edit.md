# Physical six-client live-edit round, October 9

The Mac app (0.204 build 1241), Safari, and a direct atomic TextPack writer ran
concurrently with the installed Windows app (source `19a79616`), visible Edge,
and a direct atomic TextPack writer. All six used workspace
`be28ae03-c64e-4695-80af-04f048f86f37`, item
`87622f2f-0056-42f3-ade3-bd932ce11250` (`Notes/Six-client acceptance
fable1241.textpack`), and the same signed-in account. The two native editors
and Safari editor stayed open while the timed Windows app and Edge runners
edited. This was run `fable1241d`, with a fresh scheduled start and receipts.

Three Windows app edits, three Edge edits, two Mac app edits, two Safari edits,
one direct PC file edit, and two direct Mac file edits each reached the visible
Mac editors exactly once. The Windows app and Edge runners reported success,
including editor continuity. Both Mac editors completed with Finish and no
recovery banner. The saved TextPack on each machine contained all 13 markers
exactly once and the extracted `text.md` SHA-256 matched:
`4da4e96b4425ef4b2412b8e8dc6b686c079d3ce4a7fa9b24a5bde5a8ae76b65a`.
The container ZIP hashes differ, as ZIP metadata is not canonicalized.

Receipts: Windows
`C:\Users\Shokunin\dev\texttext-live-acceptance-fable1241\{app,browser,cli}-receipts-d`,
Mac `/tmp/texttext-mac-cli-d-events.jsonl`, and the saved TextPack in the
selected iCloud workspace. The preceding `fable1241c` attempt exposed two
one-off test setup faults: PowerShell wrote a BOM to Edge's JSON plan, and the
direct PC actor lacked a receipt directory for its atomic backup. Correcting
those setup faults allowed the complete round. Preserve both sets of receipts.

The checked-in PC file actor was then rerun as `harness1241e` with a fresh
receipt directory it created itself; atomic replacement completed and wrote
`cli-receipts-e/pc-cli.json`. The Edge plan parser now accepts a UTF-8 BOM,
which Windows PowerShell commonly writes. JavaScript syntax and BOM parsing
were checked locally.

The `harness1241e` PC file edit occurred after the timed Windows app had
closed. It remained on the PC while the app was closed; after starting the
installed Windows app, its marker reached the Mac TextPack within the next
10 seconds. This confirms startup catch-up for a direct file edit. Continuous
background synchronization while the Windows app is closed was not observed
in this check.

This passes the simultaneous small-text convergence round, not the full
[acceptance contract](six-client-sync-acceptance.md). Two-account permissions,
offline/reconnect and pending-edit restart, overlapping edits, file and asset
replacement, delete/restore, repeated seeds, latency distributions, and
resource-use checks remain open. The older Windows pending journal is still
protected and was not cleared by this run.
