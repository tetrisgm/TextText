# Open Mac editor interrupted by a file rename

Source: installed Mac 0.204 (1237), Windows and Oracle `6d07ca4b`.
Fixture: `adb80788-ce35-4a18-8162-e6c7482cc736`, title
`Six-client acceptance full1237`, workspace `be28ae03-c64e-4695-80af-04f048f86f37`.

The Mac app created and saved the note. Oracle received it and the canonical PC
app downloaded identical server bytes and recorded its baseline. Both Mac app
and Safari opened Edit card without additional edits. A direct filesystem rename
from `Notes/Untitled 15.textpack` to `Notes/Six-client acceptance full1237.textpack`
propagated to Oracle and Windows.

Safari kept its editor and showed the new path. Mac changed the path but removed
the editor and displayed “This note needs to be reopened. Your edits are saved
for recovery.” No recovery action was clicked. File and journals remain intact.

The planned simultaneous run at 2026-10-09T08:02:12Z was aborted. Both PC app and
browser recorded shared readiness and zero input events; both CLI writers were
stopped before their scheduled writes. `/tmp/texttext-six-full1237/aborted-actors.txt`
records the counts. No six-client pass or timed convergence result is claimed.

Preparation: `/tmp/texttext-six1237-ready.md`. Fix investigation:
`/tmp/texttext-rename-editor-fable.txt` (Fable 5.1 Low). Current acceptance must
include filesystem rename while editing, retaining the editor and session.
