# Portable MCP folder rejection assertion

The first unified `2b470873` release stopped before delivery. Its Mac test suite found one stale assertion in `vault-mutations.test.ts`: `create_item` correctly rejected `../private`, but the new portable-path validator reports “Choose a portable folder path…” rather than the older “Invalid folder” wording. Commit `1bed84fb` updates only that expectation.

The focused MCP mutation suite passed on the Mac: 22/22 tests. The PC attempt cannot serve as a pass because Windows directory `fsync` returns `EPERM` in this suite. The release must rerun its required checks before any delivery claim.
