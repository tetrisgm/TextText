# File-vault local performance receipt

## Scope and conditions

This local measurement used the already running production Next server at
`http://localhost:3000`, build `texttext-vault-agent-fix-20261001`, and local
Postgres. The host was a MacBook Pro Mac16,1 with an Apple M4, 16 GiB RAM, and
macOS 27.0 (26A428). The server stayed warm. Each full attempt launched one
headless Chromium browser with a cold browser cache. No server restart, native
install, deployment, or owner workspace was involved. Browser requests to
external origins were blocked; none was attempted in the passing run.

Each full attempt created a distinct UUID workspace with the two existing
Ada/Grace test accounts as collaborators. Its 240 TextPacks comprised 72 image
galleries with generated 800×450 local PNGs, 32 articles, 32 bookmarks, one
long note, one synthetic agent-activity target, 47 ordinary notes, 32 projects,
and 23 journal entries. Each fixture held 1,924,561 pack bytes and 4,052,941
bytes in its vault subtree. The harness limits were 15 minutes, 2 GiB sampled
RSS per server or browser process tree, 1.5 GiB harness RSS, 100 MiB total
pack bytes, 150 MiB fixture directory, one browser, and three sequential
open/close rounds. Samples were taken about once per second. Process-tree RSS
sums can double-count shared pages and miss peaks between samples.

## Passing 240-pack run

The corrected harness completed three sequential browser open/close rounds,
two-account access, a ten-second editor-idle request count, and six synthetic
direct TextPack writes. Raw sampled evidence is
[here](/tmp/texttext-vault-perf-UA7c0d/result.json), with disposable workspace
`8557ce91-1b5b-4cf1-9070-c2a00fec6264`.

| Measure | Observation |
| --- | ---: |
| Browser navigation start to first visible heading, cold cache | 515.6 ms (n=1) |
| Same visibility, warm cache | 394.8 and 885.7 ms (n=2) |
| Folder click to visible heading, driver-inclusive p95 | 520.5 ms (n=9) |
| Item click to visible body, driver-inclusive p95 | 3,353.4 ms (n=6) |
| Input event to two visible animation frames, p95 | 30.4 ms (n=123) |
| Command-K dispatch to visible search, driver-inclusive p95 | 82.6 ms (n=3) |
| Server / Chromium / harness sampled peak RSS | 227.7 / 599.7 / 247.7 MiB |
| Chromium RSS 2.5 seconds after each close | 122.4, 134.3, 136.1 MiB |

The after-close readings rose 13.7 MiB from round one to three. Three points
do not establish a leak or a stable plateau. Each round decoded at least one
generated gallery image. The five pre-open idle samples averaged 0.6% server
tree CPU and 0% Chromium tree CPU. Five samples after the final close averaged
8.6% server and 0.2% Chromium; that window may include pending server work.
The ten seconds after a three-second editor settle had **one request**: a POST
to the test item's `/presence` endpoint, with zero collaboration POSTs. The
request was presence maintenance, not a content upload. No sampled RSS bound
was breached. CPU is a `ps` process-tree snapshot, not a continuous energy
measurement.

The six audited synthetic `external_agent` TextPack writes all completed, but
**none appeared in the already-open web editor within the 3.5-second window
after each write**. This is a measured visibility miss, not a verified real
provider operation. The separately verified real installed-app Codex edit is
outside this benchmark. Grace opened the disposable workspace after Ada's
rounds; both collaborator grants were used.

## Focused two-pack diagnosis

A disposable [two-pack trace](/tmp/texttext-vault-perf-FbFWIE/result.json)
separated request completion from visible UI work. In the full run, the six
item-navigation observations were Gallery 609.7/411.9/476.0 ms and Long note
1,096.9/1,074.6/3,353.4 ms. The 3.35-second tail was a Long note open.
Folder observations were Gallery 81.6/64.9/147.3 ms, All files return
473.9/274.2/520.5 ms, and Notes 34.0/33.1/63.8 ms. The 520 ms tail was
returning to All files from an open Gallery item.

In the two-pack trace, Gallery item click to visible body took 567 ms: its
TextPack GET finished at 130 ms, initial collaboration GET at 449 ms, and UI
became visible about 118 ms later. Long note took 923 ms: TextPack GET finished
at 410 ms, initial collaboration GET at 667 ms, and UI became visible about
256 ms later. These final spans combine browser digest/decode, Yjs setup,
React work, and paint; the trace cannot isolate them further. One gallery
preview image decoded 249 ms after the folder heading. Returning to All files
took 333 ms, including a GET of the previously open Gallery file from 56 to
308 ms before the root heading appeared. Source inspection confirms the
shared editor flush rereads the current file even with no pending edits. That
read is a concrete navigation cost. The later navigation-only flush change
removes it when leaving a web editor; rename/delete still reread the current
file. The Long note tail remains unresolved.

The same two-pack trace made one direct audited write to the open Long note.
The server's collaboration epoch advanced 1→2. After five seconds the web
editor still showed the old body with a recovery notice and a **Reopen file**
button; clicking it displayed the new text. The web collaboration client
retired on every epoch change, including a clean journal. The native editor
already has a clean-file refresh path. A follow-up source fix routes clean
epoch changes through `stale-file` and automatically reopens web sessions;
pending human edits still retire for recovery. The client suite passed 29/29
with a new clean-epoch case. The original 240-pack figures above remain
measurements of the earlier build.

## Integrated two-pack rerun

After the navigation-only flush change (`9e43db99`) and clean external-write
reopen change (`4116466e`), one [two-pack rerun](/tmp/texttext-vault-perf-OhwHVL/result.json)
used the integrated production server on localhost:3000 (PID 84641). Each
driver-inclusive click-to-visible result is one observation, so the differences
are a focused check, not new p95 estimates.

| Navigation | Before | Integrated rerun |
| --- | ---: | ---: |
| Gallery folder | 126.3 ms | 109.4 ms |
| Gallery item | 567.0 ms | 537.3 ms |
| All files from open Gallery | 333.2 ms | 41.4 ms |
| Notes folder | 40.9 ms | 32.6 ms |
| 512 KiB Long note | 923.4 ms | 753.1 ms |

The before trace's All files return included a 252 ms GET of the Gallery pack
being closed. The integrated trace had no such GET. Gallery and Long note item
opens still fetched a TextPack and initial collaboration state. The 3.35-second
Long note p95 miss from the 240-pack run has not been retested at that scale.
The direct synthetic `external_agent` write advanced the open Long note's
collaboration epoch 1→2; after five seconds its marker was visible with no
Reopen button or manual action. The before trace required a manual reopen.

The rerun's marked UUID fixture `7155bcbe-1ac9-4226-9708-cfb925d58c24` was
deleted. Three preceding two-pack attempts stopped before navigation because
the new server was launched without an absolute vault-root setting; their
marked UUIDs were `122e927f-f5fc-4071-987e-3331d90604a3`,
`daa8ddae-9f73-4ece-8680-92c11abf0cc5`, and
`c18275a5-a4ef-42bc-b5dc-3f9342868f62`. A read-only check found zero
workspace rows, collaborator scope rows, or vault directories for all four.
The harness recorded deletion of their exact audit targets. No second
240-pack run was made.

## Earlier stopped attempts

Three full fixtures stopped at a benchmark prerequisite before the corrected
run. They remain failed attempts, not passing performance runs.

| Attempt | Cold browser first visible | Gallery folder click to visible | Server tree peak RSS | Chromium tree peak RSS | Stop |
| --- | ---: | ---: | ---: | ---: | --- |
| [1](/tmp/texttext-vault-perf-prior-1.json) | 498.2 ms | — | 177.6 MiB | 351.7 MiB | Browser-side pointer observer did not report the completed folder navigation. |
| [2](/tmp/texttext-vault-perf-prior-2.json) | 515.8 ms | — | 169.4 MiB | 385.5 MiB | Same observer timed out even though the visible heading was `Gallery`. |
| [3](/tmp/texttext-vault-perf-prior-3.json) | 456.9 ms | 97.1 ms | 158.6 MiB | 395.2 MiB | The bare-title sidebar selector could not find `Gallery 001`. |

Those three cold launches gave nearest-rank p95 515.8 ms (n=3; server warm).
Their 97.1 ms Gallery navigation was a single driver-inclusive observation,
not a meaningful p95. Pre-open five-sample server CPU means varied from 0.02%
to 10.48%; they do not establish a settled baseline.

The original sidebar selector looked for `aria-label="Gallery 001"`. In the
running build, the actual attributes were `title="Gallery/Gallery 001.textpack"`
and `aria-label="Gallery/Gallery 001"`. The same path prefix appeared for Long
note and Agent activity. The harness now uses exact path `title` selectors.
Tiny disposable smokes validated Gallery image decode, folder and item
navigation, Long note typing instrumentation, Command-K, Agent activity, and
Grace opening Gallery: [two-pack smoke](/tmp/texttext-vault-perf-tOMBgI/result.json)
and [one-pack smoke](/tmp/texttext-vault-perf-nw45rW/result.json). Earlier
smoke failures exposed a harness-only `performance.now()` import inside a
browser callback; it was corrected before the passing run. Smoke timings are
not substantial-library performance samples.

## Limits and cleanup

The p95 estimates are nearest-rank statistics from small navigation samples;
the cold observation has n=1. Folder and item metrics include Playwright
dispatch, app work, readiness polling, and two animation frames. The input
metric uses browser event timestamps through two frames. The three-round RSS
series does not isolate retained app memory from Chromium caches. The
ten-second request count does not establish longer-term idle behavior.

Each result records deletion of its exact test audit targets, two grants, UUID
workspace row, and marked UUID vault subtree. An independent read-only check
found **zero** remaining `blogs` and `collaborators` rows for all thirteen
attempt/smoke/diagnosis UUIDs and all thirteen marked directories absent;
[the cleanup proof](/tmp/texttext-vault-perf-cleanup-proof.json) includes each
exact workspace ID. Audit deletion was reported by the harness but not
independently queried by item ID after cleanup. The passing JSON is 48 KiB in
`/tmp`.

Harness: [`scripts/bench-file-vault-live.ts`](../scripts/bench-file-vault-live.ts).
Read-only `--preflight`, TypeScript `tsc --noEmit`, and scoped ESLint passed.

## Current 240-pack rerun after GET authorization change

Build `.texttext/vault-perf-20261001` on the same Mac and local database completed
the full three-round harness on source `d1c9b4cd`. Raw evidence is
[`/tmp/texttext-vault-perf-vvYWym/result.json`](/tmp/texttext-vault-perf-vvYWym/result.json);
the exact UUID fixture was removed. The 240 TextPacks held 72 galleries, 32
articles, 32 bookmarks, 48 notes including one long note, 32 projects, and 23
journal entries. Two accounts opened it. All six synthetic direct TextPack
edits appeared in the already-open editor, unlike the earlier run.

| Measure | Rerun |
| --- | ---: |
| Cold first visible heading | 602.1 ms (n=1) |
| Warm first visible heading | 516.8 ms p95 (n=2) |
| Folder click to visible heading | 96.4 ms p95 (n=9) |
| Item click to visible body | 1,514.8 ms p95 (n=6) |
| Input event to two visible frames | 20.7 ms p95 (n=123) |
| Command-K to visible search | 185.3 ms p95 (n=3) |
| Sampled server / Chromium process-tree peak RSS | 204.3 / 608.1 MiB |

Gallery opens took 467.9–522.8 ms; the three 512 KiB long-note opens took
1,170.3–1,514.8 ms. Folder navigation and typing met their initial targets.
Item navigation and one Command-K sample missed. The ten-second editor-idle
window had one presence POST and zero collaboration POSTs. Five pre-open idle
CPU samples averaged 0.72% for the server tree and 0% for Chromium. Browser RSS
2.5 seconds after each close was 124.9, 142.3, and 139.2 MiB. Three points
cannot establish a leak or its absence. The synthetic agent writes verify file
observation, while the separate installed-app Codex run verifies a real agent
operation. No public deployment or release was involved.
