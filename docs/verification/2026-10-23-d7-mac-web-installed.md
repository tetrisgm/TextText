# d7a06af4 Mac and web acceptance

Actual unified release: `d7a06af43455e205a780615131f955168d034346`, installed Mac 0.203 (1278), same-source Oracle web. One acceptance pass reused the private fixtures from [a868 acceptance](2026-10-23-a868-mac-web-installed.md). These are installed/live interactions, not test-host acceptance.

## Mac exact-content durability

Opened existing `Notes/6.textpack` in `/Applications/TextText.app`, title `6Phase 2 Mac 24104475 20261023`, clicked Edit card, focused Document body and appended through real keyboard input. Checked frontmost application before every global key action. Exact resulting body:

> Mac 24104475 installed acceptance. Exact content survives normal quit and reopen. Verified Mac a868426a build 1277. Verified Mac d7a06af4 build 1278.

Normal quit was asynchronous: the immediate process check still saw TextText and immediate launch returned LaunchServices `-600`. After confirming the process had exited normally, a fresh normal launch succeeded. The reopened Note card rendered the exact title and full body. No force quit, reset, or repeated edit cycle. Initial accessibility reads before window readiness failed; the subsequent rendered-card read succeeded.

The owner's `mac/Package.resolved` remained SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.

## Oracle web exact-content durability

Reloaded the existing authenticated verification tab in Safari window 27380, workspace `be28ae03-c64e-4695-80af-04f048f86f37`. Reused `Notes/Untitled 31.textpack`, UUID `ee455de6-5640-453c-8632-7984a370688c`, title `Phase 2 Web 24104475 20261023`. Clicked Edit card, focused the real editor, and typed the release marker. Collaboration state returned `ready`; clicked Finish. Exact body:

> Web 24104475 live acceptance. Exact content survives tab close and reopen. Verified web a868426a. Verified web d7a06af4.

Closed only the verification tab normally and opened a fresh tab at the workspace URL. The exact title and full body rendered again. Other owner tabs were preserved. These local/web checks do not claim cross-client convergence while the existing invalid catalog remains unresolved.

## Stage-only native feed entrypoint

In installed Mac 1278, used existing Notes folder, More, Add agent. The UI showed the existing connected account and selected Notes folder. Typed one task asking `propose_feed` to stage `https://www.w3.org/blog/feed/`, named `d7a06af4 feed review`, without fetching, approving, subscribing, creating files, editing or deleting. Clicked Start task once.

The actual native assistant returned [proposal 21874dd2-a307-47fb-8cd7-50a08d7f8417](https://texttext.app/proposals/21874dd2-a307-47fb-8cd7-50a08d7f8417). Opened that review in a new Safari tab and read the real page: exact URL, title and Notes destination; publisher request occurs after approval; status `Waiting for your approval. Nothing has been changed.`

No approval or dismissal was performed. This accepts stage/review through the real native assistant, not feed fetching, subscription execution, or the remaining Phase 4 flows. No files or catalog directories were deleted. The retained review tab is Safari tab 24 in window 27380.
