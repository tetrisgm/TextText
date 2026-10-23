# Windows installed acceptance: a868426a

Unified release `a868426a6f87819a4673616bb41458e9350cf732` completed successfully (Mac log `/private/tmp/texttext-ship-all-a868426a-retry2.log`). Tested the installed executable at `%LOCALAPPDATA%\Programs\TextText\TextText.exe` through real Windows input and UI Automation observations, not the smoke harness.

Reused the existing owned fixture `Notes/Untitled 31.textpack`, title `Windows launch acceptance 24104475 20261023`. Opened its restored reader, clicked Edit card, focused its body, appended one marker, and saved with Ctrl+S. Exact body observed at 2026-10-23T19:26:47.114Z:

> Launch241 exact body L1. Reopened edit exact. Release a868426a exact reopen.

Quit with Alt+F4 normally at 19:26:52Z; the window was absent at 19:26:57Z. Reopened once. At 19:27:13.369Z the installed reader displayed the exact complete body above and an Edit card control, without the connection-timeout banner. Initial window `32966558`, reopened window `27264922`.

Result: installed open/edit/save/normal-quit/reopen exact-content acceptance passed. No repeated launch benchmark or three-second target claim. No journal reset, forced close, deleted content, or new duplicate fixture. The reopened app remains available to the owner.
