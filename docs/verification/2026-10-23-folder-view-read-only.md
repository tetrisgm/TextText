# Folder-view reads no longer create folders

Live web acceptance exposed the cause: typing a destination into Current folder issued metadata GETs that created trailing-space `Phase3` prefixes before any create command. `scanFolderViews` used the write resolver, whose parent walk calls `mkdir`. Three retained server names now block native catalog validation and are preserved pending a separate, reviewed repair.

The read path now uses `packPath` and the existing no-symlink parent resolver without provisioning a missing folder. It keeps the leaf regular-file check, fingerprint cache, permission checks, and all write-path guards. Missing folders return an empty folder-view list.

Focused production-store baseline failed on the old implementation. On the Mac, the corrected store and route suites passed: 40 tests with one existing skip, plus 14 route/viewer tests. TypeScript and `git diff --check` passed on the PC. The server-store suite cannot run on Windows because its existing directory `fsync` returns `EPERM`; this did not change any durability behavior. Live verification awaits the next batch release. Evidence: Mac `/private/tmp/texttext-folder-read.fGRu7V/`.
