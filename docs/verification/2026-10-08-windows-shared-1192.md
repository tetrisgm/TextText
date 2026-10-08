# Windows shared client candidate, 1192 cohort

Exact source `4e1c218b`, clean archive at
`C:\Users\Shokunin\dev\texttext-build-4e1c218b`.
Sealed candidate `windows/build/candidate-9ef20cd3305c4a248d85d532da93fb49`;
actual desktop receipt `windows/build/smoke-receipts-b7737cdda8b84a06a9fc6c94355d0392`.
Mac build log: `/tmp/texttext-windows-4e1c218b-build.log`.

The complete locked-dependency build exited zero: native storage/sync and agent
suites, 291 shared-client tests, TypeScript, self-contained publish, actual
WPF/WebView desktop smoke, and candidate sealing. The earlier `4df98955`
candidate also passed Windows checks but was superseded by the corrected
server-test freeze before installation.

Installation is **pending**. After the exact-source Mac gate passed, both
existing PC SSH routes failed before authentication: direct `pc` reset and
`pc-tunnel` closed. A later bounded direct retry also reset. No installed app
was closed or replaced, and no account, editor, workspace, or network settings
were changed. The installed app remains the verified 1191 cohort.

Resume by inspecting the live editor, normal close through its durable flush,
then use the existing installer against the sealed candidate above. Verify
account identity, original workspace/content, search and normal reopen. Do not
rebuild merely because the transport failed after the completed build.
