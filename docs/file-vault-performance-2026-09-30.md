# File-vault local performance receipt

## Final production benchmark

The final bounded run used production build `.texttext/vault-perf-20261001j` on source `08366635`, local Postgres, and one headless Chromium browser. The host was a MacBook Pro Mac16,1 with Apple M4, 16 GiB RAM, and macOS 27.0 (26A428). Browser requests to external origins were blocked; none was attempted.

The UUID fixture contained 240 self-contained TextPacks and 3.9 MiB on disk: 72 galleries, 32 articles, 32 bookmarks, 48 notes including one 512 KiB note and one agent target, 32 projects, and 23 journal entries. Two existing test accounts opened it. The harness ran three sequential browser open/close rounds, a ten-second editor-idle observation, and six direct audited TextPack writes. Every external write appeared in the already-open editor. Raw result: [`/tmp/texttext-vault-perf-sGvfUt/result.json`](/tmp/texttext-vault-perf-sGvfUt/result.json).

| Measure | Observation | Initial engineering target |
| --- | ---: | --- |
| Cold first visible heading | 748.1 ms (n=1) | Reported |
| Warm first visible heading | 568.4 ms p95 (n=2; other sample 344.0 ms) | Reported |
| Folder click to visible heading | 104.1 ms p95 (n=9) | Narrow miss against 100 ms |
| Item click to visible body | 605.9 ms p95 (n=6) | Reported |
| Cached item click to visible body | 590.9 ms p95 (n=6) | Misses 100 ms |
| Input event to two visible frames | 13.8 ms p95 (n=123) | Meets 50 ms |
| Command-K to visible search | 108.5 ms p95 (n=3) | Cold call misses 100 ms; warm calls were 19.6 and 23.9 ms |
| Server / Chromium sampled peak RSS | 220.1 / 682.7 MiB | Within harness bounds |
| Chromium RSS 2.5 seconds after close | 144.3, 148.1, 130.6 MiB | Ends lower; no monotonic growth in three rounds |

The five idle CPU samples averaged 0.06% for the server process tree and 0% for Chromium. The ten seconds after editor settle made one presence POST and zero collaboration POSTs. This is the expected presence heartbeat, with no repeated document sync. All exact item locators resolved, both accounts used their grants, all six external mutations became visible, and the run recorded zero blocked external requests.

## Focused diagnosis and integrated checks

- A preceding two-pack diagnosis passed on the same source: Gallery folder 122.9 ms, Gallery item 150.0 ms, 512 KiB note 288.5 ms, and cached long note 428.9 ms. A direct external write appeared in the already-open editor without reopen. Receipt: `/tmp/texttext-vault-perf-tnEyEF/result.json`.
- The final offline browser run after natural folder ordering passed: `/tmp/texttext-final-browser-order.log`.
- The contextual-header change in `31281f03` does not change the measured storage or navigation path. Its production build and full offline browser suite passed separately: `/tmp/texttext-vault-perf-k-build.log` and `/tmp/texttext-header-portal-browser.log`.

## Final native recovery check

The final local artifact is `/Applications/TextText.app` 0.202 build 1149 on `2b47c500`. It launched without a false Offline banner and completed a real read-only bundled-agent task. Build 1148 separately verified account disconnect, helper termination, draft preservation, normal browser reauthorization, and successful use of the preserved request. Earlier build 1147 acceptance verified that a controlled outage preserved pending edits locally; after the task-owned server returned, collaboration and background sync notices cleared automatically without Retry. After fixture cleanup, current sync state is 31 baselines, outbox 0, and conflicts 0. A real agent edit also converged with a concurrent human line and matched the canonical TextPack. These are installed-app acceptance results, not additional benchmark samples. Final build and install receipts are `/tmp/texttext-build-1149.log` and `/tmp/texttext-install-1149.log`.

Spot samples during the live native agent checks observed TextText at 35.0 MiB RSS and its bundled Codex helper at 62.9 MiB while working. The helper was 43.9 MiB after completion; after the panel closed and settled, TextText/helper samples were 12.3/6.7 MiB. These bounded `ps` observations confirm the active agent was included in memory inspection, but they are not continuous peak measurements or a long-run leak proof.

## Interpretation

Typing and idle behavior meet the initial targets. Folder navigation is close to its target but measured 4.1 ms over it. Warm Command-K is comfortably within target, while its first cold call is 8.5 ms over. Cached item open remains the material performance miss at 590.9 ms p95. The six item samples range from fast gallery opens to the 512 KiB note tail, so further work should begin with a bounded item-open trace rather than another full fixture.

The three after-close browser readings end below the first reading and show no sustained growth in this run. Three rounds cannot prove the absence of a memory leak, and process-tree RSS can count shared pages more than once or miss peaks between samples. The result supports bounded stability only under the stated workload.

## Limits and cleanup

The p95 values are nearest-rank statistics from small samples. Folder and item metrics include Playwright dispatch, app work, readiness polling, and two animation frames. Input timing uses browser event timestamps through two frames. CPU is a sampled `ps` process-tree observation rather than continuous energy measurement.

The passing harness deleted the exact test audit rows, grants, UUID workspace row, and marked UUID vault subtree. Its result records that cleanup. The isolated PostgreSQL instance on port 55432 was stopped after the final checks. No public deployment, release, owner workspace, private R2 bucket, or production account was involved.

Harness: [`scripts/bench-file-vault-live.ts`](../scripts/bench-file-vault-live.ts). Read-only preflight, TypeScript, scoped ESLint, production build, and the local browser fixture passed for this acceptance sequence.
