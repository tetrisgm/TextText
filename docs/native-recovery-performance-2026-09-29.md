# Local native recovery and File Provider check, 2026-09-29

## Failed saved-link retry without duplication

Installed build 1112 opened the local Blog bookmark `example-invalid-3` with
its original `https://example.invalid/texttext-recovery-1e08b463-fa43-45cd-bd68-dfc4d29a6f83`
link, a readable-capture failure, and Retry capture. Pressing Retry showed
"Waiting for a readable copy. Your link is saved" and disabled repeat capture.
After the capture agent's failed attempt, the same page again showed Open
original, the hostname error, and Retry capture. The canonical store still
had item `381a981b-d2f2-40ba-9541-2d2456dec77a` at the same slug and URL
with failed status. The four pre-existing `example.invalid` bookmark IDs were
unchanged, and exactly one bookmark matched this source URL. The invalid
source necessarily could not yield a readable article; the proof is that
failure preserved a usable, singular saved link.

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

Later on build 1112, Finder itself opened the TextText File Provider domain,
the `visual-demo` workspace, and its 96-item `Visual scale proof` folder.
Finder reported all 96 items and showed `Visual scale 001.textpack` as a
2,430-byte TextPack document in Get Info. Direct Terminal listing of the same
domain still returned `Operation not permitted`, so Finder was used for this
check. Opening the domain started File Provider extension PID 86624; its
process CPU increased from 0.07 to 0.11 seconds over roughly 83 seconds of
root/folder navigation and one Get Info request. This observed workload did
not reproduce the earlier large reconciliation burst and is not a numerical
speed comparison for that burst. The Finder window and Get Info panel were
closed after the check.

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

## Isolated production-mode native cold open

An isolated Next production build at source `cfa43626` passed on the Apple
M4/16 GiB Mac (macOS 27.0), using local Postgres. An ad hoc signed, sandboxed
Store-shaped `TextText Agent Test.app` loaded that build from a temporary
local server on port 3131. The server used local `AUTH_URL` and
`TEXTTEXT_PRODUCT_ORIGIN` settings so sign-in and redirects stayed local.
The test bundle was separate from installed build 1112 and did not contain
the installed app's File Provider or app-group configuration.

The app process was fully quit before each launch. With an already signed-in
test profile and a warm production server, the process start and first
`WKWebView.didFinish` layout-log timestamps were:

| Launch | Process start (UTC) | `didFinish` (UTC) | Approximate interval |
| --- | --- | --- | --- |
| 1 | 08:34:44 | 08:34:46 | 2 s |
| 2 | 08:46:08 | 08:46:10 | 2 s |
| 3 | 08:49:04 | 08:49:06 | 2 s |

The native UI check also showed the signed-in local workspace after each
launch. Timestamps have one-second resolution. This measures process start
to navigation completion, not first interactive content, a cold server, a
clean sign-in, or the installed app's full extension set. A formal follow-up
target is p95 at or below 3 seconds over 20 comparable warm-server native
launches; these three samples are preliminary, not a p95 result. The earlier
6.4–6.7-second development-server UI observation includes automation gaps
and is not a direct before/after comparison.

The isolated app's assistant showed `Connect an AI to start`, so no active
agent turn or process-tree memory trend was measured in this run. The test
app and temporary production server were closed afterward; the installed
build 1112 and its local development server remained running. Build and
test-app logs: `/tmp/texttext-ux-native-cold-build.log` and
`/tmp/texttext-ux-native-cold-test-app.log`. The temporary build and app
artifacts were retained for inspection.

The already connected installed build 1112 then completed two read-only
Anthropic turns on the existing local typing test note: it returned the exact
typing marker and counted seven human and six agent lines. The note stayed
Saved with the same body. A spot sample during the second turn summed about
288 MiB RSS across the TextText process and its identified WebKit GPU,
networking, and content processes; an immediate post-turn sample summed
about 159 MiB. macOS compressed-memory accounting and the brief observation
make these point samples unsuitable for a leak or sustained-memory claim.
The installed development server was not included. A longer repeated-use
process-tree run remains necessary.

## Two-minute agent and visual-folder memory profile

The installed development-signed build 1112 remained open throughout this
check. A 121-sample, one-second-interval trace followed its native process
and the WebKit GPU, networking, and content processes launched with it;
the raw PID/RSS/CPU samples are in
`/tmp/texttext-ux-active-agent-memory-20260929.csv`. The app completed one
more correct read-only Anthropic turn on the local test note, opened the
96-image `Visual scale proof` folder, switched to the 25-item Blog folder,
reopened the note, hid the assistant, and returned to All items. The note
remained Saved. All four identified process IDs remained alive throughout.

Combined RSS was 306 MiB at the first sample, 258 MiB at the last, and
varied between 59 and 429 MiB. Mac memory compression and swapping make
that series unsuitable for a leak conclusion. `vmmap -summary` showed a
larger physical footprint after the agent/folder sequence: about 373 MiB
native, 89 MiB GPU, 15 MiB networking, and 750 MiB WebKit content, roughly
1.2 GiB combined. Hiding the assistant measured about 373+31+15+719 MiB;
returning to All items measured about 373+47+15+760 MiB. WebKit malloc
included roughly 346 MiB allocated in the content process at one later
sample. This is significant retained memory in a long-lived app pointed at
a development server; it is not yet evidence of monotonic growth or its
cause. The 96-item fixture uses 1600×900 static covers for most cards and
may raise the decoded-image/cache baseline. Compare a clean isolated
production-mode app before and after that folder when memory pressure is
lower. The development server was excluded from process totals, and no
other app's memory was attributed to TextText.

## Clean production-mode image-folder comparison

The retained isolated production build at source `cfa43626` was run through
the sandboxed `TextText Agent Test.app` on the same Mac, with a local
production server on port 3131. Its native bundle, WebKit GPU, networking,
content, and idle Codex helper processes were included. The assistant was
hidden; no agent turn ran in this comparison. `vmmap -summary` footprints
were sampled sequentially after visible UI transitions, so totals are
approximate rather than simultaneous accounting.

| State | Combined physical footprint |
| --- | ---: |
| Signed-in All items before image folder | ~349 MiB |
| First Cards view, after scrolling through the folder | ~498 MiB |
| Back to All items | ~455 MiB |
| Second Cards view, after traversing again | ~543 MiB |
| Back to All items again | ~465 MiB |

The native UI showed decoded image cards and, after scrolling, later items
from the 96-item folder. The first folder visit added about 149 MiB at its
observed peak; about 106 MiB remained after leaving. The second post-folder
reading was about 10 MiB above the first, within the substantial variation
seen in macOS process accounting. This two-cycle production-mode check does
not reproduce an immediate runaway leak or explain the long-lived installed
development app's roughly 1.2 GiB footprint. It also does not establish
long-run stability. The fixture reuses large static covers for most cards,
so it is a stress case rather than a typical upload with generated previews.
The isolated app and temporary server were stopped and port 3131 was free;
the installed build 1112 and its development server remained running.

## Repeated long-lived native gallery visits

On the same still-running installed development build 1112, the app and its
identified WebKit GPU, networking, and content processes retained PIDs
55440, 55447, 55452, and 55453. `vmmap -summary` reported physical footprints
of 334.3, 88.7, 15.9, and 949.7 MiB (about 1.39 GiB combined) with the
existing test note and assistant open. I hid the assistant, visited the
96-image `Visual scale proof` folder six times, and traversed its cards from
`Visual scale 096` to `Visual scale 001` and back during the visits. The
native UI visibly rendered the first, middle, and last gallery cards. I
returned to All items between visits, then reopened the original test note
and assistant.

Intermediate content-process readings varied from 996 MiB to the coarse
`1.1G` display; after leaving the gallery it read 913.9 MiB. Once the note
and assistant were restored, the four footprints were 334.5, 99.8, 15.8,
and 940.9 MiB, about 1.39 GiB combined and within a few MiB of the starting
sample. System-wide reported free memory was 37% before and 41% after.
This several-minute repeated-use pass shows no monotonic footprint growth
for that route in the long-lived app. It does not establish long-run memory
stability, a production-mode footprint, or the cause of the already-high
WebKit content baseline. The local development server was excluded.

## Ten-minute isolated production-mode gallery run

The retained source-`cfa43626` production build and sandboxed test bundle ran
against local port 3131 on the Apple M4/16 GiB Mac. The already signed-in app
opened the 96-image `Visual scale proof` folder, scrolled to the final cards,
and returned to All items twenty times. The assistant stayed hidden; the
bundled Codex helper was idle. `vmmap -summary` physical footprints included
the native app, its WebKit GPU/network/content processes, and the helper.
Samples were sequential, so totals are approximate.

| State | Combined physical footprint |
| --- | ---: |
| After the first folder traversal and close | ~322 MiB |
| After 5 closes | ~440 MiB |
| After 10 closes | ~373 MiB |
| After 15 closes | ~387 MiB |
| After 20 closes | ~404 MiB |
| At about ten minutes elapsed, idle on All items | ~388 MiB |

The same five process IDs survived the run. At the final idle sample, each
reported 0.0% CPU, the content process had accumulated 23.66 seconds of CPU
over 9m53s, and system-wide reported free memory was 41% (35% before this
test). The post-close samples fluctuated without a steady upward sequence;
the final idle sample held near the preceding level. About 66 MiB remained
above the first close, so this does not identify or rule out retained decoded
image/cache memory. It does not cover an active agent turn, new unique image
assets, a current-source production build, or hours of use. The test app and
its temporary server were stopped; port 3131 was free, while installed build
1112 and its local development server remained running.

## Isolated native authorization cancellation

At source `5c64a742`, I built a separate Store-shaped `TextText Agent Test.app`
against the existing local development server on port 3000. Its bundle ID and
Codex profile are separate from `/Applications/TextText.app`. In the test
app's AI settings, Disconnect exposed Continue with ChatGPT. Clicking it
showed **Authorizing** and **Cancel setup** and opened Safari to OpenAI's
account chooser. Clicking Cancel setup returned the test UI to **Not checked**
and **Continue with ChatGPT**. The test app's Codex helper process exited;
the app did not change to a connected state on a later UI observation. I
closed only the Safari tab created for this check and quit the test app.

This proves the visible canceled-setup path and cleanup in an isolated native
session. It does not inject a deliberately delayed login completion or prove
every response-order race. The installed app and its local server were not
restarted or replaced.

## Debug launch timing probe

An isolated debug-only test build with `TEXTTEXT_LAUNCH_METRICS=1` recorded
process start, WebKit commit/finish, window presentation, and hydrated workspace
paint. In one local-development-server launch on September 29, WebKit committed
at 1,323 ms and finished at 1,654 ms, but the window was not presented until
15,115 ms and the paint marker fired at 15,571 ms. The computer-use launcher
returned a timeout while opening the bundle in the background; subsequent UI
inspection brought it forward. An earlier background launch similarly
produced a spurious 60,321 ms paint marker. These runs identify foreground
activation as the measurement artifact and cannot establish cold-open latency.
The debug markers are opt-in and excluded from release builds. The isolated
test app and helper were quit; the installed app and development server stayed
running. The following foreground run supersedes this open measurement.

## Twenty foreground native launches

On September 29, Finder opened an isolated, sandboxed debug test app in the
foreground twenty times, fully quitting its process before each reopening.
The native binary was built at `2bade379`; its copied test bundle used the
retained local production web build at `cfa43626` on port 3131 and an already
signed-in test profile. The local production server stayed warm. The opt-in
launch marker required the **All items** heading, hydrated Save to TextText
control, library filter, and two animation frames. Every run visibly reopened
the signed-in workspace at the expected local origin.

| Process start to first usable content | Result |
| --- | ---: |
| Samples | 20 |
| Minimum | 1,180 ms |
| Median | 1,418 ms |
| p95, nearest rank | 1,881 ms |
| Maximum | 1,907 ms |
| Latest window presentation | 1,048 ms |

All twenty runs were below the brief's 3-second p95 target under these
conditions. The full native marker log is
`/tmp/texttext-native-launch-20-20260929.log`. This measures a warm local
server, retained older production web build, signed-in isolated app, and
hydrated-content proxy. It does not measure a cold server, first sign-in,
current-source release build, or the installed app's File Provider extension.
The test app and port-3131 server were stopped after the run; installed build
1112 and its port-3000 development server remained running.
