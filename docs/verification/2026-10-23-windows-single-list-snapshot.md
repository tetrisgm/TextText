# Windows listing uses one native snapshot

Installed d7 acceptance still missed startup targets ([receipt](2026-10-23-windows-d7-installed-acceptance.md)). Source investigation and a production transport harness proved each renderer list request called native `files.list` twice: the shared transport already returned folders, then the Windows wrapper reread them. A change between replies could combine first-generation items/permissions with second-generation folders.

The wrapper now attaches the native status root to the shared listing without rereading its manifest. Focused list/open regressions return different folders on a hypothetical second request and require one native call, coherent items/folders/permissions, and the native root. Both failed before the fix; both pass afterward. This removes an actual redundant request and coherence defect, not a measured claim that native scans or startup now meet three seconds.

Checks: full Windows transport test file 21/21 PASS on PC and Mac; PC TypeScript noEmit exit 0. PC logs: `%TEMP%/texttext-list-snapshot-red.log`, `texttext-list-snapshot-green.log`, `texttext-list-snapshot-tsc.log`. Mac isolated source check: `/private/tmp/texttext-list-snapshot.0G7s9C/result.log`; owner checkout and Package.resolved untouched. No installed launch followed this source change; unified release and installed acceptance remain pending.
