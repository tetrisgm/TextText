# Invalid intermediate TextPack while editors stay open

On October 9, build 1241 on Mac, signed-in Safari, and the installed Windows
app used the dedicated six-client fixture `Notes/Six-client acceptance
fable1241.textpack`. The Mac and Safari editors were open. A direct Mac file
writer replaced that file with invalid ZIP bytes for 250 ms, then atomically
installed a valid archive containing `[mac-cli:invalid-intermediate1241:00]`.
The writer kept a byte-for-byte backup and would have restored it if the repair
failed.

Both open editors stayed mounted, showed the repaired content, and had no
recovery banner. The Windows saved file received the valid marker and did not
import the invalid intermediate bytes. A subsequent Mac app edit
`[mac-app:after-invalid1241:00]` appeared in Safari. A subsequent Safari edit
`[mac-web:after-invalid1241:00]` appeared in the Mac app. Both editors saved
normally. The Mac and Windows `text.md` projections contained each new marker
once and had the same SHA-256:
`0262cdbc984b28763f1c32ef5e1a926830f5c165fdf9465ac865280be8d3978b`.

The native core regression now covers the same scanner/sync contract: an
invalid intermediate TextPack cannot replace or delete the remote document;
after an atomic valid repair, the next sync pass uploads it without manual
retry. `dotnet run --project windows/TextText.Core.Tests/TextText.Core.Tests.csproj
--configuration Release` passed on Mac.

This checks a brief invalid intermediate write and recovery on one file. It
does not establish simultaneous overlapping typing, offline pending-edit
reconciliation, multi-account access, or sustained latency and resource use.
See [the full acceptance contract](six-client-sync-acceptance.md).
