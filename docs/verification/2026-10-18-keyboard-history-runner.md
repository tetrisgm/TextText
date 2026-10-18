# Keyboard history runner preparation, 2026-10-18

Status: source preparation, no physical acceptance claimed.

The bounded append-only `undoRedo` scenario drives four real editor actors with
one marker through insert, undo and redo, using platform keyboard input. A
450 ms idle separates prior history from the new operation, matching the actual
400 ms capture timeout in UnifiedDocumentEditor. It never calls UndoManager or
mutates content through a test hook. File actors write concurrently as before.
Each observed history stage preserves the entire prior baseline and all visible
non-own content, compares Unicode codepoints, and records once/absent/once for
the exact new marker. Final operation accounting remains one append per actor.
Wrong actor, absent/skipped stages, nonmonotonic time and lost content fail;
partial failure preserves completed stages and the uncertain attempted action.

The staged protocol unit suite passed four tests:
`/private/tmp/texttext-history-protocol-unit-20261018.log`.
The isolated actual Chrome 155.0.8059.84 contenteditable driver fixture passed
with trusted insertText, historyUndo and historyRedo input events:
`/private/tmp/texttext-history-driver-fixture-20261018.log`.
This proves keyboard-driver mechanics, not application history or collaboration.
The complete current stress JavaScript suite passed 94 tests, zero failures or
skips in 34.959 seconds: `/private/tmp/texttext-history-stress-final-20261018.log`.
Actual-PC LiveAcceptance-only compile passed in 1.96 seconds, zero errors and
one existing NU1510 warning: `/private/tmp/texttext-history-pc-compile-20261018.log`.
Only actor source was backed up/replaced; Core and MainWindow DLL hashes were
unchanged before/after and matched the actor output copies. No actor was launched.
Actor source SHA256:
`c246a57823f326d0ff47ca641ee4461c59e6049a7f20daa228d38fec5d65f5e3`.
Actor DLL SHA256:
`e4662276a309bfdd7165132ba9e633074ec4f0aa11c1fe5e15f9b67e98ee74df`.
Mac history actor compiled in root gate 91129; that combined gate failed a
separate test-fixture compile. The corrected required full gate 59231 passed (app 50, FileProvider 203, CLI 40;
10 explicit opt-in skips, zero failures):
`/private/tmp/texttext-removal-lease-cancel-native-final-20261018.log`.

Multiple fields are deliberately separate: current title/file stem is also the
actor fixture/navigation identity. Browser crash restart, file bursts/in-place
writes, creation, moves, deletion/restore, stale writers and authorization fault
matrix scenarios remain outstanding. See the updated runner preparation inventory.
