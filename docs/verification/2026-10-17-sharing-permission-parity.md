# Shared links and permission controls

October 17 source slice following `a6c93792`. Not installed or deployed.

## Behavior

Native Share links now use the connection's verified workspace web address. The shared helper rejects synthetic/file origins, credentials, mismatched workspace paths and remote plain HTTP. Copying a link does not create a permission grant.

Web, Mac and Windows Share/comment controls now read the same authenticated workspace access endpoint through their existing account-bound transport. Owner, editor, commenter and viewer controls derive from the same validated response. Native connection status alone no longer grants Share or comment actions. The Mac relay pins the current workspace and rejects request parameters; cancellation and existing account fences remain in place.

Routine status notifications preserve a typed Share email. Actual account/workspace replacement invalidates the previous response and closes the old Share dialog. Offline comment drafts remain mounted and reappear on reconnect. Permission refreshes coalesce to one active read and one followup, preventing status-event storms from cancelling every slow response. Server authorization still applies to every mutation.

## Evidence

- 91 focused bridge, transport, link and access tests: `/private/tmp/texttext-capabilities-final-unit.log`.
- Production Share component and clipboard at file, synthetic Windows and web origins: `/private/tmp/texttext-share-link-browser.log`.
- Production VaultApp browser fixture: owner/viewer/commenter/editor controls agree between native/web transports; draft preservation, workspace replacement and late old-account reply checks pass. `/private/tmp/texttext-workspace-access-browser.log`.
- Mac authenticated request builder and existing relay regressions: 23 `LocalVaultCollaborationTests` passed, `/private/tmp/texttext-access-mac.log`. Swift package resolution was preserved.
- Full client gate: 476 tests, TypeScript and exact-source receipt passed, `/private/tmp/texttext-access-schedule-client-stable.log`. This run also includes the concurrent scheduler unit slice. An earlier run passed its tests but correctly refused a receipt when parallel source edits changed the fingerprint.

These isolated fixtures do not establish physical account switching, live permission propagation across installed clients, or completion of the six-client campaign. Those remain in T23 and final delivery.
