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
- Native Windows core: 109 storage/sync assertions; native agent/flush checks
  include saved-account restoration and signed-out polling.
- Final Mac shared subsystem: 234 tests passed; Windows client subset: 172.
- Actual Windows editor: eight checks covering creation, search, input, autosave,
  and reopen. Added actual MainWindow close integration after a missing RPC
  handler escaped the lower-level flush tests. The Windows build now requires
  this desktop gate before issuing an installable source/artifact receipt.
  All eight editor and five actual MainWindow close assertions passed on the PC.
  The final build command also completed with exit status zero.
- Historical 125-second picker evidence remains applicable; picker code unchanged.

Local UI receipts are under `.texttext/windows-smoke/`; PC candidate/test logs
are under `C:\Users\Shokunin\dev\texttext-sync-20261007\windows\build`.

## Final candidate and verification limits

Last installed candidate is `8ca77072ef324c95b4202de1e79ac490`, source
`911e7564` (UTF-8 subprocess fix). Exact-source/artifact verification and all
build gates passed before installation. Previous app:
`TextText-previous-20261007T155724-bc262a43`. Build log:
`windows-final-utf8-build.log`; passing desktop receipts:
`windows/build/smoke-receipts-8b5efd2734e149318439dc771df70f1b`.
The live agent/sync/close observations below were completed on the immediately
preceding candidate `e97aec8b1d2d480785e1e9e6bfc66e7f`; they are not evidence
that the last installed candidate started successfully.
The final candidate includes lazy saved agent-account restoration, shared agent
presence readiness, and validated durable-checkpoint readiness. The portable
native suite passed 109 assertions; the final candidate also contains the
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
read-only Unicode check has **not** run because startup stalled.

## Remaining Windows startup blocker

Installed UTF-8 candidate process 40024 had no visible window. A managed stack
captured the main thread in WPF `DUCE.Channel.SyncFlush` through
`HwndTarget.UpdateWindowSettings`, `Window.ShowHelper` and `App.Main`.
This is an evidenced native compositor startup stall before document loading,
not a sync failure. Receipt:
`.texttext/windows-smoke/final-live/wpf-startup-stack.txt`.
The exact process was stopped for replacement after capturing the stack; content
was not changed. No global GPU, Windhawk or network settings were modified.

Commits `277f5a22` and `7d838ec6` configure process-local software rendering for
native WPF chrome and exercise the same configuration in the desktop harness.
Mac WPF/harness cross-build passed. Two subsequent PC candidates were **not
sealed or installed**: their native/core/agent/shared-client/build checks passed,
but the bounded desktop harness timed out before writing its Main-entry receipt.
The second unsealed candidate is `8aaf54743aae46cf8123ef8aed64af6c`; log
`windows-final-software-build.log`, attempted smoke receipt identifier
`795c22f32c3a471197e7d85632ed7d5d`. The directory was never created.
This pre-entry harness symptom has not been proven to share the compositor cause.
Loaded modules included CLR, PresentationCore and Windhawk; that inventory alone
does not identify the cause. Managed diagnostic collection did not complete
before the bounded test process ended. A native wait-chain capture was prepared,
but the process had already exited.

PC SSH subsequently timed out during banner exchange and SCP closed its
connection, independently observed by two agents. A new focused diagnostic
launch did not execute. Remaining work: capture the pre-entry native wait chain,
pass the unchanged desktop gate, install the verified software-rendering candidate,
verify two normal startups and the read-only Unicode response, and record its
installed hashes. Do not report Windows final acceptance complete.

## Verification limits

Actual second-Apple-device iCloud delivery, Windows provider eviction/hydration,
and hardware power-loss behavior are not established by these tests. Missing
provider files, interrupted operations, lost acknowledgments, external edits,
and future journal versions have automated regression coverage.
