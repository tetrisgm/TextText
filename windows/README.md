# Windows desktop

The WPF host embeds the shared TextText editor in WebView2. Credentials and local
TextPack writes belong to the native host. Node and the .NET SDK are build tools;
the published app is self-contained and does not require them on a user's PC.
The Microsoft WebView2 runtime must be installed.

## Explicit local build and install

From a Windows checkout with npm dependencies installed:

```powershell
powershell -NoProfile -File windows/scripts/bootstrap-sdk.ps1
node windows/TextText.Windows/fetch-runtime.mjs
powershell -NoProfile -File windows/scripts/build.ps1
powershell -NoProfile -File windows/scripts/install.ps1 -Candidate <printed-candidate-path>
```

Build checks native storage and agent subprocess regressions, shared client tests,
and TypeScript, bundles the shared editor, runs the actual desktop/editor/close
regressions in the signed-in desktop session, and publishes a self-contained win-x64 desktop candidate. Its receipt binds all
source inputs and every published file, including UI assets. Install rejects changed
sources or artifacts, stages and verifies a copy before replacing the app, and keeps
the previous installation alongside it. It refuses to replace a running installed
app. User content and account state are outside the application directory and are
never removed. There are no scheduled builds, installation jobs, or public updates.

The native receipt does not establish UI parity or replace the Mac shared-sync
regression suite. Run relevant shared tests on the Mac before committing changes.

## Native smoke checks

Use a temporary workspace and an explicit test account. Record executable hash,
source receipt, result, and observed failure for each check. Never infer success
from a window appearing or from a Node-only protocol test.

1. Launch the installed executable through its Start Menu shortcut. Confirm an
   account is required, login returns to the app, and restarting retains it.
2. Create and edit a note, search its unique text, close and reopen, and confirm
   saved content and title. Check all supported template creation/editing flows.
3. Edit the TextPack text file externally. Confirm the open editor and search
   reflect it without overwriting an unsaved competing edit.
4. Disconnect networking, edit, close/reopen, reconnect, and verify the edit on
   web and Mac. Repeat with simultaneous edits from another client.
5. Interrupt the app during a queued write. Relaunch and confirm recovery and
   eventual convergence, with no duplicate operation or silently missing content.
6. Exercise rename/delete, temporary unavailable files, invalid TextPacks, and
   stale authentication. Unavailable files must not become cloud deletions.
7. Confirm shared presence, comments, agent interaction, attachments, and logout
   have the same product behavior as Mac and web. Record unsupported capabilities
   as gaps rather than marking parity complete.

The existing PC source copy is `C:\Users\Shokunin\dev\texttext-sync-20261007`.
Avoid concurrent native builds against that checkout.

`windows/scripts/smoke.ps1` runs a separate WPF test executable using the real
WindowsBridge and shared renderer. It uses an isolated temporary workspace and
an offline fixture account exclusively in that test executable. It checks UI
startup, note creation, save/reopen, and local search, then writes JSON and a PNG
under `windows/build/smoke-receipts`. The run has a 90-second deadline and cleans
its temporary workspace/device state. This smoke is not an authentication,
multiplayer, installed-app, or complete parity certification.

The smoke launcher builds in the invoking session, then creates an immediate,
interactive task that runs only the test executable. This is necessary when
invoked over SSH: its service session cannot provide a valid WebView window.
The temporary task has a 100-second limit and is always removed. No recurring
job, production launch, build task, or installer task is registered. The signed-in
Windows user must have an active desktop session.

## Explorer activation

The local installer adds TextText to **Open with** for `.textpack` without
changing the chosen default. A second launch forwards requests to the existing
process over a current-user-only pipe. The app waits for sign-in and the editor,
then saves before opening a file inside the current account's workspace.
Files outside that workspace are not imported or moved. Opening another
workspace from Explorer remains unsupported until workspace selection exists.

### Workspace folder location

File → Open workspace folder (Ctrl+Shift+O) selects an alternate local folder
for the current signed-in cloud workspace. TextText flushes the open editor
before switching, remembers the location per workspace, and keeps the previous
folder and device journal. Empty folders require confirmation before the
workspace downloads there. Already bound folders must match the current server
and workspace; unrelated nonempty folders are not silently imported/uploaded.
Missing saved folders keep the account signed in and offer folder selection.
Explorer requests outside the current root offer the same picker.

This changes a workspace's local location; it does not create or switch cloud
workspaces. An account-level multiworkspace API remains separate work.
