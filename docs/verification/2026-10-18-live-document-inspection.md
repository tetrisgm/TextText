# Live editor inspection for physical acceptance

The editable UnifiedDocumentEditor registers its currentLocalDocument reader while canEdit is true, and unregisters on item change, permission loss or unmount. window.texttextDocumentInspection exposes version 1 and read(itemId) only. It returns a validated detached full DocumentSnapshot from the current editor, including accepted pre-ready edits. It does not fetch, flush, apply, or inspect files. Closed documents return null; multiple live registrations for one item refuse ambiguous observation. Stale cleanup removes only its own token.

Three focused Vitest tests pass for current/full snapshots, detached mutation safety, ambiguous editors, closure, stale cleanup, invalid identity and schema validation. TypeScript noEmit passes. Logs: `/private/tmp/texttext-live-inspection-unit-20261018.log` and `/private/tmp/texttext-live-inspection-typecheck-20261018.log`.

This API is available in private production-shaped builds and web builds. It exposes only the already loaded editable document to the same page context. Physical actors must independently check selected item and account/root bindings before reading. Actual editor/browser integration and six-client multi-field acceptance remain separate pending runner work; these unit checks do not establish that acceptance.
