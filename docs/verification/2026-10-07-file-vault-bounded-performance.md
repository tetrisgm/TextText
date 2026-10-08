# Bounded file-vault diagnosis

Production artifact: `texttext-oracle-20261008T060605Z-98bb52b5`, isolated APFS clone of the standalone build, Node 22.19.0 / Next 16.3.8, loopback port 3198. MacBook Pro Mac16,1 / M4 / 16 GiB / macOS 27.0.1.

Local Postgres preflight verified the existing Ada and Grace fixture accounts and their established workspaces. No accounts were created. Each diagnosis created two TextPacks (2.1 MiB fixture), then removed its exact UUID workspace, grants, audit rows and marked vault subtree. Browser requests stayed local; zero external requests occurred.

Updated `--diagnose` selectors to current Gallery lightbox, Notes reader and TextText home button. Reader navigation still waits for actual content and two animation frames. External file mutation must now become visible automatically or through the offered reopen action, rather than merely recording failure in a passing result.

## Measurements

Two successful diagnostic runs, milliseconds, driver-inclusive:

| Operation | Run 1 | Run 2 |
|---|---:|---:|
| Gallery folder | 119 | 125 |
| Gallery image | 36 | 41 |
| Notes folder | 42 | 43 |
| Long note reader | 1624 | 1533 |
| Cached long note reader | 1513 | 2267 |

The long note has 7,300 repeated lines (roughly 525 KiB). Run 1 cached HEAD/collaboration responses completed around 45 ms; remaining reader cost dominates. Historical measurements in `docs/file-vault-performance-2026-09-30.md` used an older editor path and are not an identical UI comparison, but this is a concrete large-note rendering delay to investigate.

Direct audited file edits advanced the collaboration epoch and appeared within the five-second observation window without a manual reopen in both runs. Peak sampled server RSS: 168/190 MiB; browser process-tree RSS: 551/590 MiB. These are bounded small-fixture observations, not a leak/idle/typing/search benchmark or a 240-item performance guarantee.

Evidence: `/tmp/texttext-vault-perf-gYX1tw/result.json`, `/tmp/texttext-vault-perf-WhYJJi/result.json`. Both report complete fixture cleanup. Earlier failed selector-only attempts also cleaned their fixtures.

Verification: scoped ESLint, full `tsc --noEmit`, and the updated diagnosis passed. No product code or live user content changed.

## Scoped reader fix

A Chromium CPU profile (`--diagnose --profile`, `/tmp/texttext-vault-perf-VIhmO3/reader.cpuprofile`) attributed about 1.8 seconds of self time to micromark's data-token coalescing resolver in the production bundle. Thousands of soft line breaks cause repeated array-splice work. This is parser work, not a transport delay.

The shared reader now recognizes a conservative single plain paragraph without Markdown punctuation, indentation, blank-line blocks, whitespace normalization or GFM autolinks. That subset renders directly as a paragraph; ambiguous input retains the unchanged Markdown pipeline. Complete text remains in the DOM and editability is unchanged. The recognizer uses linear scans and no retained content cache.

The actual shared `VaultNoteDisplay` was bundled with the normal production local-UI builder and measured in Chromium with the same 7,300-line body. Unoptimized ReactMarkdown baseline: 257.5 / 352.1 ms. Full optimized note reader: 62.6 / 69.0 ms in light mode and 48.6 / 53.4 ms in dark mode. Exact full-body equality and Edit card action passed. This component-level measurement isolates the parser fix; integrated Next route timing requires the next production build and is not claimed here.

Regression evidence: 59 focused tests (plain-paragraph differential against actual GFM, highlight rendering and render nodes), full TypeScript and scoped ESLint passed. Differential cases include soft breaks, leading/trailing whitespace, tabs, CRLF, HTML/entities, backslashes, autolinks, tables and lists. Unit tests are in both sync configurations; the production browser test is part of `npm test`. The manually started loopback server was terminated after diagnosis. No persistent job or production configuration was installed.

### Unchanged collaboration rerenders

An instrumented production browser fixture using the real `CollaborativeVaultEditor` and renderer confirmed an additional cause: initial Markdown parse count 1 became 5 after four status updates, then 6 after a presence update. Recursive asset substitution created fresh asset arrays every render, invalidating the reader's Markdown memoization even with unchanged content.

Memoizing substituted display data by the actual snapshot and asset resolver keeps counts at 1/1/1. The browser regression verifies body changes, replacement blob URLs, image alt/dimensions, theme and template changes still render. It runs in the normal long-note browser gate. No global content cache was added. Scoped lint and browser checks passed; the full TypeScript run at this point reported an unrelated concurrent `write-proposals.server.ts:421` argument-type error, to be checked in the combined cohort.

## Integrated production remeasurement

Fresh standalone `texttext-oracle-20261008T063810Z-68eaaf80`, isolated APFS clone, same loopback port/local DB/existing accounts/two-pack fixture, passed preflight and `--diagnose`.

| Operation | New integrated run (ms) | Earlier 98bb52b5 runs (ms) |
|---|---:|---:|
| Gallery folder | 69 | 119 / 125 |
| Gallery image | 32 | 36 / 41 |
| Notes folder | 43 | 42 / 43 |
| Long note reader | 170 | 1624 / 1533 |
| Cached long note reader | 254 | 1513 / 2267 |

External file mutation still appeared within the five-second observation window without reopening. Peak sampled RSS was 253 MiB server / 573 MiB browser tree. All exact UUID fixture cleanup checks passed; zero external requests. The manually started local server received SIGTERM and exited. Evidence: `/tmp/texttext-vault-perf-v7s3z1/result.json`.

This is one bounded integrated confirmation after two baseline runs, not a percentile, broad library benchmark, or long-duration memory test. It confirms the demonstrated large-note reader regression is resolved in the real production route without sacrificing automatic file-change convergence.
