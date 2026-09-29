# Local native recovery and File Provider check, 2026-09-29

## File Provider reconciliation

The installed development-signed Store-shaped build 1111, pointed to the
local server, had a File Provider process with 38m43s CPU over 33m15s
elapsed during workspace reconciliation. A five-second sample at
`/tmp/texttext-fileprovider-2026-09-29.sample.txt` put most active samples
in `WorkspaceEnumerator.findFile`: each single-file lookup converted every
manifest entry in every folder, including sibling date parsing, before
returning one item. The process later returned to idle. This is evidence of
expensive bursts, not sustained idle CPU.

The lookup now identifies claiming folders by stable item ID and maps only
the requested item. It still compares sibling filenames, including folder
names and case-folded collisions, so direct lookup returns the same Finder
name as enumeration. All 116 File Provider kit tests passed; a new case
compares both paths in an 800-item folder with file and folder collisions.

Build 1112 was signed, verified as Apple silicon with all three extensions,
and installed at the sole `/Applications/TextText.app` path. The installer
launched it with `http://localhost:3000`; the old app was moved to Trash by
the recoverable installer. The exact test log is
`/tmp/texttext-fileprovider-tests-2026-09-29.log`; build and installer logs
are `/tmp/texttext-fileprovider-build-1112.log` and
`/tmp/texttext-fileprovider-install-1112.log`.

After installation the app reopened the same private local test note. A new
File Provider process used about 6.7 seconds of CPU over its first four
minutes and a later five-second sample was idle. macOS shows three TextText
Finder domains from earlier local installs; they were left in place. The
new sample did not capture a matching large reconciliation burst, so it
does not establish a numerical before/after speedup or a whole-app memory
result. The source-level hot path and test coverage support the narrower
conclusion that per-item date parsing and full item mapping are removed.

## Editor retry on an inconclusive connection

On its first reopen, build 1112 showed **Connection not confirmed** on the
test note. The server was responding and the note text remained visible.
The prior Retry saving callback only flushed a dirty materialization; with
no new keystrokes it returned immediately and left the warning in place.
The button now starts a fresh provider catch-up when the writer has not
caught up or there is no pending materialization. If a caught-up writer has
pending changes, it uses the existing guarded flush.

After a full app quit and relaunch, the warning recurred on the same note.
Pressing **Retry saving** now moved it through **Waiting to save** to
**Saved**, with the original title and prior human and agent lines intact.
The connection became inconclusive despite the local server responding to
the collaboration route, so the editor now automatically gives one
non-authoritative startup a fresh provider unless the writer was retired or
lost access. A third full app reopen showed the note at about 6.7 seconds,
**Waiting to save** by 11.4 seconds, and **Saved** by 15.4 seconds without
pressing Retry. These times include UI automation/tool gaps and a warm
development server, so they are not production-mode launch benchmarks.

Two post-reopen snapshots around 30 seconds showed about 190 MiB combined
RSS for the app, its Finder extension, and WebKit processes launched with
it. A third snapshot was lower; no monotonic increase was visible in these
three cycles. WebKit affiliation was inferred from launch time, and this is
too short to establish long-run memory stability. The local Next server is
separate and was not included. TypeScript, 86 related web tests, and touched
ESLint passed (two pre-existing Hook dependency warnings). No public
service or release changed.
