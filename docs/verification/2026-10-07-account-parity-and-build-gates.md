# Account parity and build verification, October 7

## Shipped behavior

Mac 0.204 (1177), Windows candidate37bde and Oracle now use the same account
menu and Settings component. The authenticated workspace account endpoint
returns only email, name, connected provider names and workspace name. Native
Mac requests remain pinned to the account's bound workspace. Web logout now
requires the editor's persistence guard before invalidating the browser session.
Settings has no logout, Finder path or sync-setup controls.

Actual Mac and Safari Settings show `ramine@ramine.net`, workspace
`ramine@ramine.net's blog`, and `Apple Connected`. Closing Settings returns to
the unchanged note and actual email in the sidebar. No live logout was performed.
Safari retained all original verification markers plus the Mac1177 save marker;
Mac and Windows presence remained visible. Screenshot:
`/tmp/texttext-live-account-settings.png`.

Windows actual account Settings verification remains pending because SSH access
failed after the final build. See the Windows receipt; no final activation
installation is claimed.

## Checks

- 39 focused logout/transport/Windows tests passed; blocked/throwing save guards
  prevent any logout request. Provider profile is bound to the authenticated user.
- Nine account route/auth and 14 targeted Swift collaboration tests passed.
- One local PostgreSQL account-collision regression passed.
- Browser fixture passed offline save, raw-file refresh, conflict preservation,
  search, template/capture flows, narrow layout and keyboard behavior. New
  account dialog was inspected in light and dark; Escape and focus return passed.
- Final Oracle source `c5d625b7`: exact-source core238 and native sync gates
  passed; TypeScript passed. No failed or stale receipt was reused.
- Eleven image-processing regressions passed with sharp0.35.5. Production npm
  audit reports zero vulnerabilities. Five dev-only ESLint-chain advisories remain.
- Four sync gate regressions passed, including execution through a symlink.
  The old main-entry path comparison silently skipped `/tmp` invocations on
  macOS. Mac1177 was explicitly verified through `/private/tmp`; `ba132012`
  fixes subsequent invocations and tests rejection of invalid flags via a symlink.
- Final Windows build uses npm11.10.0 and installs locked dependencies before
  testing. PC npm10 rejected the lock; the pinned version passed without lock edits.

## Oracle deployment

`release/ship.sh --web-only --skip-tests` reused separately passed relevant
source checks and matching full sync receipts; deployment packaging, restore,
bootstrap and TypeScript gates also passed. A clean committed build snapshot
was used, excluding unrelated worker edits. Initial build failed before any
server changes because Turbopack rejects node_modules symlinks outside its root;
replacing that temporary symlink with an APFS clone resolved it.

Live deployment: `texttext-oracle-20261008T002518Z-c5d625b7`.
Fresh validated backup: `texttext-20261008T002625Z-83906e54.dump`.
Authenticated session, cookie mutation origin enforcement, workspace reads,
note creation/edit, canonical storage and action audit smoke passed; scratch
workspace removed. Previous release is retained for rollback.

TextText and Algorave app/database/HTTPS services remain active. HAProxy mtime
is unchanged at `2026-10-01 00:11:31.941901734 +0000`.
A real image encode/decode on Oracle confirmed sharp0.35.5 works on Linux ARM64
and returns the expected2x2 dimensions. No public desktop release was published.
