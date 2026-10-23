# Windows installed241 launch result

Installed commit: `2410447543bd883cd23abd305ade14e183e6f5d7` (same-commit release receipt successful). Actual installed executable `%LOCALAPPDATA%/Programs/TextText/TextText.exe`; real workspace `be28ae03-c64e-4695-80af-04f048f86f37`.

Created a unique note through native UI: **Windows launch acceptance 24104475 20261023**, path shown by app `Notes/Untitled 31.textpack`. Typed `Launch241 exact body L1.`, saved with Ctrl+S, quit normally with Alt+F4, reopened exact. Entered Edit, focused actual body and appended ` Reopened edit exact.` with real native input, saved and quit normally (window disappearance observed266ms). Second reopen displayed the exact full body `Launch241 exact body L1. Reopened edit exact.`. Fixture preserved, no file injection or journal changes.

Measured restored launches using actual native UIA, timestamp origin immediately before supported installed app launch:

| Run | Listing | Restored exact note/Edit action | Timeout |
| --- | --- | --- | --- |
|1|Absent at2.562s; present by11.007s (coarse observation gap)|Exact original body present by11.007s|None observed|
|2|Absent through4.294s; first observed4.457s|Absent through6.539s; exact body+Edit card first observed6.701s|None observed|

Run2 sampled approximately every160–190ms, beginning1.050s after launch. This is a clear failure of the plan's under3s listing target; the restored editable target also cannot pass given the later restored view. The later actual edit confirms functionality, not under3s readiness. Stopped after the clear failure as directed rather than repeating the remaining three launches. Five-launch exit gate remains incomplete and Phase2 does not pass.

Evidence: `%TEMP%/texttext-installed-launch-measurement/launch2-241.json` and native Computer Use transcript. First cold launch before fixture preparation showed the Notes listing by12.434s (not counted as restored-note run). Initial click required foreground recovery due to another user window; no ambiguous input was repeated without reobservation. Final app left open on exact restored fixture and UI lane handed to coordinator for multiplayer validation. No simulations or process-only liveness counted as installed acceptance.
