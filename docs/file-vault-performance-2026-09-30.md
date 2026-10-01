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
found **zero** remaining `blogs` and `collaborators` rows for all twelve
attempt/smoke UUIDs and all twelve marked directories absent. This includes
the passing workspace above and the three earlier full-attempt UUIDs in their
raw results. Audit deletion was reported by the harness but not independently
queried by item ID after cleanup. The passing JSON is 48 KiB in `/tmp`.

Harness: [`scripts/bench-file-vault-live.ts`](../scripts/bench-file-vault-live.ts).
Read-only `--preflight`, TypeScript `tsc --noEmit`, and scoped ESLint passed.
