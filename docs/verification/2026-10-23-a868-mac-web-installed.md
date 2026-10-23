# a868426a Mac and web installed acceptance

Unified release `a868426a6f87819a4673616bb41458e9350cf732` completed with exit 0. Release log: Mac `/private/tmp/texttext-ship-all-a868426a-retry2.log`. Installed Mac build: 1277.

## Actual Mac acceptance

Used the existing private fixture `Notes/6.textpack`, UUID `c4eca6f3-1799-4e37-8e08-c844592435e2`, in the installed `/Applications/TextText.app`. Command-K opened its existing title, `6Phase 2 Mac 24104475 20261023`. Clicked Edit card, focused Document body and appended through real keyboard input. Frontmost application was checked before each global key action.

Exact resulting body:

> Mac 24104475 installed acceptance. Exact content survives normal quit and reopen. Verified Mac a868426a build 1277.

Normal AppleScript quit completed with process absence confirmed. Reopening the installed app rendered the exact title/body in the Note card. Independent read of the canonical TextPack under `~/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace/Notes/6.textpack` confirmed the exact body. An initial accessibility read preceded window readiness; the subsequent rendered card was verified. No force quit or journal changes.

## Actual Oracle web acceptance

Reloaded the existing authenticated Safari verification tab on `/vault/be28ae03-c64e-4695-80af-04f048f86f37`. Reused `Notes/Untitled 31.textpack`, UUID `ee455de6-5640-453c-8632-7984a370688c`, title `Phase 2 Web 24104475 20261023`. Clicked Edit card, focused the real editor and appended through keyboard input. Collaboration state returned `ready`; clicked Finish.

Exact resulting body:

> Web 24104475 live acceptance. Exact content survives tab close and reopen. Verified web a868426a.

Closed only our verification tab normally, opened a fresh tab at the workspace URL, and verified the exact title/body rendered again. Existing owner tabs were preserved.

## Live folder-read regression

Authenticated live GET `/api/vault/be28ae03-c64e-4695-80af-04f048f86f37/items?folderViews=Read-only%20folder%20probe%20a868426a` returned HTTP 200 with `{"files":[]}`. Read-only Oracle filesystem checks before and after confirmed that the requested missing directory did not exist. This verifies the deployed read does not provision that directory; it is separate from UI acceptance.

The three prior trailing-space directories (`Phase3 `, `Phase3 A `, `Phase3 A 98b5314a `) still existed and were empty. None was deleted or repaired. Cross-client convergence and multiplayer remain blocked by that existing invalid catalog; these independent durability checks do not claim convergence. No new fixtures or screenshots were created.
