# Mac editing-session lifecycle

## Reproduced cause

`AppDelegate` retains `LocalVaultWindowController` and its WKWebView when the
window closes. `windowWillClose` previously called `collaboration.cancelAll()`,
which removed the native session tokens. The retained JavaScript editor kept
its token and could send its next checkpoint while hidden or after reopening.
The native bridge then rejected the save with “This shared editing session has
closed. Your recovery journal is kept.” Credential changes used the same
invalidation pattern and replaced the sync actor under the retained editor.

The native regression test first failed at checkpoint 2, immediately after
closing the window, with that exact bridge error. It used an isolated folder,
a real TextPack, the real sync actor and relay, and an AppKit window. It had
pending edits; no Oracle connection or outage was involved. This reproduces
the reported error; no historical trace establishes which invalidation event
preceded the original screenshot.

## Correction

Native sessions now live as long as their retained editor. Window close keeps
them; sign-out explicitly shuts them down after the existing save gate.
Credential refresh validates the workspace and updates the existing transport
token without replacing the sync actor. Reselecting the same folder is a no-op.
Disposing a connection cancels its work and prevents retries restarting it.

The earlier clean-session recovery is now limited to the specific native
session error. Generic conflicts and other retired journals cannot trigger it.
Pending updates still prevent discarding the journal.

## Verification

- Red reproduction: `LocalVaultSessionLifecycleTests`, original close handler,
  failed on the second checkpoint with `LocalVaultCollaborationError`.
- Fixed native lifecycle, credential refresh, relay and shared-file tests:
  26 tests passed. Writes before close, while hidden, after reopening and after
  credential refresh use the same native session and reach the file. The
  refresh fixture rejects old bearer tokens; the same sync actor reads
  successfully after renewal.
- Collaboration client: 38 tests passed, including retaining pending edits on
  unexpected session loss and refusing to discard unrelated retired journals.
- TypeScript check passed. Local Store-shaped build 0.204 (1172) signed and
  verified with its three extensions; installed at `/Applications/TextText.app`
  through the existing local-development install path, without release
  attestation.
- Installed-app verification: typed a temporary line in the existing
  verification note, immediately closed with Command-W, reopened the retained
  window, typed a second line and finished editing. Both lines reached the
  local TextPack and the signed-in Safari workspace on Oracle. No recovery
  banner appeared. Removed the two temporary lines through the editor and
  observed that cleanup arrive live in Safari; original note text remains.

The existing TextText Changelog was absent from the active workspace; no
duplicate was created. No Oracle deployment or public Mac release was needed.
