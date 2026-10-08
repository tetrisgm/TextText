# Windows desktop and live cross-client verification

## Installed product

The self-contained WPF/WebView2 executable is installed under
`C:\Users\Shokunin\AppData\Local\Programs\TextText`. It uses the same VaultApp,
renderer and full-document collaboration client as Mac/web. Native code owns
filesystem persistence, the durable sync outbox and checkpoints, DPAPI TextText
account storage, and the bundled Codex process. No Node runtime is required.

Real browser device sign-in completed against Oracle. The installed app rendered
the existing workspace and downloaded all 21 original TextPacks with no pending
operations. User files were preserved. Start Menu entry is installed; earlier
application candidates are retained for rollback outside the workspace.

## Live file convergence

Only a new test note was changed: item
`6df95934-cd09-4a73-b9e6-a6fb8a453547`,
`Notes/Windows sync verification 20261007.textpack`.

1. A direct Windows filesystem creation uploaded and appeared on the Mac and
   in actual Safari, including its exact unique marker.
2. A Markdown-only ZIP edit on the Mac, preserving all JSON and assets, reached
   the open Safari editor and the Windows file. No duplicate note was created.
3. Actual Safari editor input reached both desktop files.
4. With Windows stopped, another Markdown-only change was made. The next native
   startup retained its account and uploaded that edit. It appeared in the still
   open browser editor and in the Mac file.
5. Installed Mac 0.204 (1174) saved another paragraph, which reached Safari and
   Windows. All prior markers remained. Mac quit/reopen retained the saved note.
6. Safari showed the Mac and Windows as active participants in the same note.

Windows local archive hashes matched its acknowledged sync baseline after each
completed pass; the outbox was empty. ZIP bytes need not match other platforms'
compression encoding; document content is the interoperability contract.

## Agent authorization

The actual Windows Connect Codex action launched the bundled native runtime.
The existing account chooser and personal-account consent completed in Edge;
its normal localhost callback returned to the app. TextText displayed
`Connected as ramine@ramine.net`. No password, token file, or credentials were
copied between machines. This is built-in agent authorization, not commercial
Sign in with ChatGPT for a TextText account.

## Regression gates

- Full Mac web suite: 4,303 passed, 146 skipped; database suites: 114 passed.
- Native Windows core: 112 storage/sync assertions; native agent/flush checks
  include saved-account restoration and signed-out polling.
- Final Mac shared subsystem: 234 tests passed; Windows client subset: 172.
- Actual Windows shared UI: 26 checks covering note creation, search, actual
  editor input/autosave/reopen, article/bookmark/gallery/talk creation through
  their UI, template-preserving shared-command edits, and native image bytes
  and dimensions after reopen. One trusted recovery-path check and five actual
  MainWindow close assertions also passed. Non-note body edits use the shared
  command contract; this does not claim typing coverage for every rich editor.
  The Windows build requires this desktop gate before sealing an installable
  source/artifact receipt.
- Historical 125-second picker evidence remains applicable; picker code unchanged.

Local UI receipts are under `.texttext/windows-smoke/`; PC candidate/test logs
are under `C:\Users\Shokunin\dev\texttext-sync-20261007\windows\build`.

## Final candidate and verification limits

Final source `c1c999648289f7efc8bcb7d5855156cad07e1ad3` completed the full
manual Windows build with exit zero. Sealed candidate:
`6ecf6765af1d4a2e871a03a6b5f2ce70`. Expanded desktop receipt:
`windows/build/smoke-receipts-1962809f581d477eb76e1a0b28dce860`; build log:
`windows-final-software-build.log` (historical filename; rendering is default).
After PC access recovered, the installed receipt still differed and no app was
running. The established installer verified source/artifacts twice and installed
this candidate, preserving `TextText-previous-20261007T165524-9fa0f669`.
The preceding focused expanded smoke also passed:
`windows/build/smoke-receipts-882acd2cf6ed441da603f59ff639cbcc`.

The previous installed candidate was `8ca77072ef324c95b4202de1e79ac490`, source
`911e7564` (UTF-8 fix); it has now been replaced by the candidate above.
The live agent/sync/close observations below were completed on the immediately
preceding candidate `e97aec8b1d2d480785e1e9e6bfc66e7f`; they are not evidence
that every later candidate received the same live test.
The final candidate includes lazy saved agent-account restoration, shared agent
presence readiness, and validated durable-checkpoint readiness. The portable
native suite passed 112 assertions; the final candidate also contains the
saved-file close proof. Final shared client run passed 172 tests.
The final installed Windows app restored the saved Codex account without a
Connect/OAuth click. At 22:40:37 UTC the actual textarea and Start task button
submitted one request to append `Windows Codex live edit 20261007.`. Actual
Safari displayed that sentence and `Codex (agent) · TextText on Windows` alongside
the two desktop participants. The Mac iCloud TextPack independently contained
that marker exactly once, preserving the earlier Mac agent, Mac editor and
Windows stopped-app markers. The real Mac agent had similarly completed its
append and live attributed-presence lifecycle. The first real turn exposed an ACK-notification gap: the file was acknowledged
but its native reader stayed waiting. Commit `96d02284` notifies that transition;
`8bdae21e` prevents protected checkpoints from amplifying cloud polling;
`1048ba24` permits closing only a proven saved, read-only detached file.
At 22:50:28 UTC the final installed app submitted one actual agent task to append
`Windows ACK refresh verification 20261007.`. By 22:50:49 the native reader had
refreshed automatically, displayed the sentence and all earlier markers, and
showed no waiting banner. Safari independently showed the same content; the
Mac iCloud TextPack contained the new sentence exactly once. Normal close directly from that selected reader exited the process without
force or a warning dialog. Disk contained all eight markers once, the outbox was
empty and no pull was pending. Note archive hash:
`461bef0a83af85ddd8acaee401dff2ae39613aa6d72a92ea68a99c65dfe01b0c`.
Reopen restored the selected note with all eight markers, the TextText account,
and the saved Codex account without OAuth. A visual check found garbled Unicode
punctuation in the agent reply. Commit `911e7564` explicitly configures UTF-8
stdin/stdout/stderr; its subprocess regression exchanges literal curly quotes,
accented text, CJK and emoji in tool arguments, results and final messages.
Mac portable tests and WPF cross-build passed. The subsequent installed-candidate
read-only Unicode check passed on the final candidate, as recorded below.

## Windows test-launch startup diagnosis

The startup blocker was traced to our temporary test launcher. Windows Task
Scheduler defaults to priority 7, intended for background CPU, I/O and memory
work. That did not represent an ordinary desktop launch. The installed process
was confirmed `BelowNormal`. [Microsoft documents the priority mapping](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-priority).

Controlled independent probes on the same PC:

| Probe | Result |
| --- | --- |
| 10,001 BCL URI operations, SSH | 9 ms |
| Same BCL operations, interactive task | 11 ms |
| Minimal WPF, task priority 7, default rendering | First render 14,496 ms; exit 18,699 ms |
| Same WPF, task priority 7, software rendering | First render 24,225 ms; exit 27,788 ms |
| Same WPF, task priority 4, default rendering | First render 494 ms; exit 545 ms |
| Independent WPF/WebView2, priority 4 | Environment 314 ms; ready 622 ms; navigation 708 ms |

An earlier managed stack showed WPF `DUCE.Channel.SyncFlush` before window
creation. Separate isolated stacks/dump showed slow WPF/BCL initialization, not
TextText sync code. Windhawk module presence was not causal evidence. Neither
process-local software rendering nor disabling diagnostic ports established a
fix; both experiments were removed. No global GPU, hooks, networking or runtime
settings changed. The isolated dump remains local and ignored.

Commit `c2761fd9` sets the desktop smoke task to normal interactive priority 4
and verifies the registered setting before launching. The existing 90-second
harness and 100-second task limits remain unchanged. All eight editor and five
actual MainWindow close checks passed at normal priority/default rendering and
diagnostics: `windows/build/smoke-receipts-1563843c20424878a0c2989eb399eda7`.
Commit `ff3462c1` removed the unproven rendering workaround. Useful startup
boundary diagnostics remain in the test-only harness.

The earlier installed process was preserved while its actual state was checked.
Correcting only that test-launched process to normal CPU priority let it render
the signed-in account and all eight existing probe markers. No new OAuth or
credential copying was required. Prior unsealed candidates were never installed.

## Final installed acceptance

Candidate `6ecf6765af1d4a2e871a03a6b5f2ce70` opened with the saved TextText
account and all eight markers. At 23:56:39 UTC the actual native assistant sent
one read-only request; the actual Codex reply was exactly `“Café” 日本語 🧪`.
Saved Codex authorization restored without OAuth. UI Automation data was saved
as UTF-8 and compared by exact string equality; the SSH console itself cannot
faithfully display these characters. No document mutation was requested.

At 23:58:35 UTC, actual Windows Comments controls posted
`Windows native comments verification 20261007.` on the dedicated test note.
Safari independently showed its Windows author and text. Windows then resolved
that thread; both clients displayed Open 0 / Resolved 1 automatically, without
browser reload. The unique test thread remains resolved.

Normal window close exited without force or a warning; reopening restored the
signed-in account, selected note and all eight markers by 00:00:32 UTC Oct 8.
Initial spaced observations showed the WebView shell before content, so a
subsequent precise startup measurement polled UI Automation every 250 ms from
process launch, without screenshots. Shell appeared at 752 ms and the selected
reader containing the eighth marker at 1,435 ms (00:01:29 UTC). Normal close
before this measured reopen also succeeded. The earlier 20–30 second estimate
included setup/observation gaps and was not a startup measurement.
The final disk receipt confirmed eight markers exactly once, outbox 0, no
pending pull, and an acknowledged archive hash after comment convergence:
`afd0dad6ca0877b052441c6b50f334fc13937fee710997011c3625ee95b2c25c`.

Installed SHA-256:

- `TextText.exe`: `8eaf0eb49815a8c12240c408b20a8d88d6d36a8bce2382692e86e629cc56c37f`
- `TextText.dll`: `a2e0b16c5411746f549dc589830552e707588067fde31fedfdf7da0ec0ec41ee`

Native Settings remains a limited account/location information surface. Real
user logout was deliberately not exercised; no full OS-integration parity is
claimed by the shared-content checks.

## Verification limits

Actual second-Apple-device iCloud delivery, Windows provider eviction/hydration,
and hardware power-loss behavior are not established by these tests. Missing
provider files, interrupted operations, lost acknowledgments, external edits,
and future journal versions have automated regression coverage.

## Account, search and file-activation follow-up

Source `346ddf0d` passed the Windows gates and installed candidate
`37bde41a123d42b09de28a46dac547fb`; previous app is retained as
`TextText-previous-20261007T171640-94305ab7`. Startup measured 710 ms to shell,
1,604 ms to the existing verification note. Actual command search for the
body-only phrase `Windows ACK refresh verification` returned the correct note
and relative path. Account Settings verification awaits the Oracle endpoint.

Final source `035f5fd7` adds guarded single-instance file activation and pins
npm 11.10.0 with a clean dependency install inside the build. PC npm 10.9.8
rejected the canonical lock; pinned npm 11.10.0 installed it successfully with
no lock changes. The complete gate passed: 117 native assertions, 176 shared
client tests, 28 actual shared UI checks, recovery access and eight window
close/activation assertions. Sealed candidate:
`699cd68d717142d0bbcbae3efd8c0eb5`; desktop receipt:
`windows/build/smoke-receipts-c9d9be89632041d997aaeb648d741672`.
The preceding candidate `e060104a879043709020b285be6ba09d` was deliberately
not installed because its build used the older dependency tree.

After PC SSH recovered, the installed reader was checked first: no active
editor, all previous markers and the new Mac 1177 account-verification marker
were visible. Normal close succeeded. Candidate `699cd68d717142d0bbcbae3efd8c0eb5`
was verified twice and installed, preserving
`TextText-previous-20261007T184113-1f330807`.

Actual installed shared Settings showed `ramine@ramine.net`, its correct
workspace and Apple Connected through the live Oracle account endpoint. Body
search again returned the correct note/path. Passing a real same-workspace
TextPack path to a second native process forwarded to the existing window;
the second process exited 0 and the original PID remained the sole instance.
Interactive-user registry inspection confirmed TextText in OpenWithProgids and
no `.textpack` default override. Pending-edit activation safety was tested in
the mandatory real MainWindow smoke; this live check used a saved reader.

Normal close/reopen passed, restoring the account and selected note. Measured
reopen: shell 796 ms, reader 1,754 ms. Disk confirmed all nine markers exactly
once, outbox 0, no pending pull and an acknowledged archive SHA-256:
`2e8b78392fb98d4311317bcd130f30f97e6158ae178e2ce617cdf47c3279b1b5`.
Final installed DLL SHA-256:
`69c6ea7916780cc963d3289dd699502e6df66b8623975456f7ad33f5fe641947`;
EXE SHA-256 remains the apphost hash recorded above. The installed app remains
open on the saved verification note. No additional user files were changed.

## Sign-in management link follow-up

Source `889bac73` passed the mandatory clean dependency/native/shared/UI gates.
Installed candidate `c69bcd6c9a17491db56c038836e963a0`, previous application
`TextText-previous-20261007T190234-489a3272`; desktop receipt
`windows/build/smoke-receipts-d97b7fe1856a49d78a9a8aaeb6a9c54c`.
The verified candidate includes updated shared UI assets; native DLL is unchanged.

After the Oracle deployment, actual Windows Settings showed account details.
Its Manage sign-in methods link opened Edge at
`https://texttext.app/account/sign-in-methods?account=1ce83017-26f8-4023-b3a9-7e6e40966204`,
confirmed from the actual address bar. No provider was linked or unlinked.
Body search still returned the existing verification note. Normal close/reopen
passed with selected-reader readiness at 1,599 ms. All nine markers remained
exactly once, with the same acknowledged note hash, empty outbox and no pending
pull. The installed app was left open on the saved note.

## Workspace-folder switch follow-up and startup correction

The first folder-switch candidate `2eb4dcc737ef49ca91ca58408fc666b1` passed
its then-existing gate but exposed a real blank-window regression at startup:
replacement WebView2 initialization awaited a view not attached to the WPF
presentation source. No user editor had initialized and no notes were lost.
The blank app closed normally. The known working `c69bcd...` candidate was
restored through the source/artifact verified installer and opened the saved
reader in 2,285 ms at 02:29:52 UTC, PID 28112.

`033231ae` stages a replacement view in the live visual tree while retaining the
old presentation. Preparation failure restores the old view. The mandatory
native smoke now executes production `OpenWorkspace`, injects a commit failure,
asserts the prior view remains usable, then opens successfully and checks a
loaded visible view with the actual local document. Retired-view writes are
also rejected before they can reach the replacement bridge.

Final source `033231ae` passed the complete Windows gate and produced sealed
candidate `b4ba548f662943ec9b70749f58f7442f`, desktop receipt
`windows/build/smoke-receipts-069e308ed25547bfb6264197d215e72e`.
Before subsequent close/install commands could execute, both documented PC SSH
routes reset/closed again. The known working app remains the last confirmed
installed/open app. Final installation, actual folder-picker switch/back and
final screenshot are pending access recovery; no rebuild is needed.

## Final home-view candidate installed after access recovery

Source `160a74ba` passed the complete Windows build, native/Core/agent/shared
checks and actual MainWindow smoke. Candidate
`2ceb30aa87be49b0a9a70919f50a6fcd` was sealed; desktop receipt:
`windows/build/smoke-receipts-d2c4b4a750c8438cbb3eb05858876eb5`.
The existing app was not running at the preinstall check. Source and artifact
verification passed twice; installation preserved
`TextText-previous-20261007T195626-e6d343c2`.

At 02:56:53 UTC, actual installed UI showed the correct signed-in account,
workspace, 16 home items and List/Cards controls. List was selected and visually
checked in light mode (`/tmp/texttext-windows-list.png`). Normal close succeeded;
List persisted on relaunch. Cards was restored, then the existing Windows sync
verification note was opened without edits. Fresh UIA at 02:59:36 UTC showed all
nine markers and TextText on Mac presence. Disk verification confirmed all nine
markers exactly once, unchanged acknowledged archive hash
`2e8b78392fb98d4311317bcd130f30f97e6158ae178e2ce617cdf47c3279b1b5`,
empty outbox and no pending pull. Installed DLL SHA-256:
`a26a5cacb193bc35e48ece2bc3cda2c48a2e3abef74cd068f26bf28e6e04506f`;
EXE SHA-256:
`8eaf0eb49815a8c12240c408b20a8d88d6d36a8bce2382692e86e629cc56c37f`.
The historical proof script's candidate label was stale; these hashes and the
verified installer output identify the new candidate.

The timing fixture expected a selected note while startup restored home, so
its timeout and stale prior timestamp are not a startup timing result. Actual
home and reader acceptance above passed independently. The owner was actively
using the PC during final checks; the folder-picker switch/back and unobscured
final reader screenshot were not performed. Replacement-workspace startup and
failed-switch retention did pass the mandatory native smoke. No user content
was changed. Temporary verification tasks removed themselves after execution.

## Canonical file backend candidate 116d3dde

Exact source `116d3dde` completed the Windows clean build and all mandatory
native/Core/agent, TypeScript, 189 shared-client and real MainWindow smoke
checks. Sealed candidate `6c51e20e7df74552b663767a9390de38`, smoke receipt
`windows/build/smoke-receipts-1a8e16d2d33f43958d6dfd9da95f6eb0`.
The existing saved reader was inspected before normal close; no unsaved editor
was active. Installation verified source/artifacts twice and retained
`TextText-previous-20261007T202834-cce8095c`.

Installed startup restored the signed-in account, original workspace and saved
verification note: shell 1,004 ms, reader 2,095 ms at 03:28:38 UTC. Actual body
search for `Windows ACK refresh` returned the correct note and path. Normal
close/reopen passed again: shell 670 ms, reader 1,399 ms at 03:29:54 UTC.
At 03:30:05 UTC, disk verification confirmed nine markers exactly once, empty
outbox, no pending pull and the unchanged acknowledged archive hash recorded
above. No user document was modified; save/failed-flush behavior was exercised
by the isolated mandatory native smoke, not by editing the live note.

Installed DLL SHA-256:
`a53c282bc4d46cf70e8bc23e4611482589ee562131c478fa0778e386d62ffb8c`.
EXE remains `8eaf0eb49815a8c12240c408b20a8d88d6d36a8bce2382692e86e629cc56c37f`.
The legacy proof helper still prints its historical candidate label; installer
receipt and DLL hash above identify this candidate. App left open on the saved
reader. Oracle-specific fresh-account provisioning and hosted agent commands
await the matching server deployment; this local acceptance does not claim
those live server checks.
