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
