# Content-first shell production check, September 28, 2026

The checked source is local `main` commit `9a0ffbe1`, built with Next.js 16.3.4 in `.texttext/ux-shell-build` and served temporarily on port 3131. This was Chromium on an Apple M4 Mac with 16 GiB RAM and macOS 27.0, using local Postgres and the existing small `visual-demo` mixed workspace. It measures the web build, not the separately installed TextText Mac app. The temporary server was stopped after the check.

`scripts/bench-content-first.ts` used a fresh browser context, 20 warm Command-K and Notes-folder samples, and ten warm opens of an existing note. Durations include Playwright driver overhead and end at DOM visibility or focus. The script now waits for the dev sign-in form to hydrate and uses the new All items entry. Logs: `/tmp/texttext-ux-shell-build.log`, `/tmp/texttext-ux-shell-bench.log`, `/tmp/texttext-ux-shell-server.log`.

| Interaction | Earlier baseline `9737093b` | Shell `9a0ffbe1` | Assessment |
| --- | --- | --- | --- |
| First library item after one navigation | 1,604 ms | 325 ms | Single cold-ish samples, not a stable comparison |
| Warm Command-K focus, p95 (20) | 50 ms | 60 ms | Under 100 ms target |
| Warm Notes folder switch, p95 (20) | 88 ms | 63 ms | Under 100 ms target |
| Warm note open, p95 (10) | 403 ms | 398 ms | Misses 100 ms target |

Warm medians for the shell were 29 ms, 57 ms, and 295 ms respectively; maxima were 183 ms, 139 ms, and 398 ms. This small fixture does not establish results for a substantial mixed library, visual-heavy folder, long document, two collaborators, native cold launch, or active agent. Whole-app process-tree memory and idle CPU remain unmeasured. System-wide `memory_pressure -Q` read 50% free shortly before the build and 53% after the test; this is not a TextText memory measurement. The next performance work should profile note open on a realistic fixture before changing editor or rendering code.

## Corrected follow-up on current local source

The earlier 398 ms warm note-open figure included a Playwright click waiting
for the preceding return-to-Home transition to settle. It was not a clean
click-to-content measurement. A production build of the later local source
(through `70b526f5`; subsequent `9e4a0241` changed tests only) ran on the same
Apple M4 Mac, macOS 27.0, local Postgres, and `visual-demo` workspace, now with
roughly 800 mixed items. The benchmark waits for the prior transition and the
Blog folder content to settle before timing the next action. It measures the
first open separately from 20 repeated opens of the existing **Note** titled
“Codex capture verification 2026-09-25.” The in-page note timer starts on
pointer-down and ends when its reader enters the DOM; it excludes Playwright
driver overhead and does not claim the final screenshot has painted.

| Interaction | Current local production result | Limit |
| --- | --- | --- |
| Home navigation | 590 ms, one sample | Includes server and browser driver; not a cold-launch distribution |
| Warm Command-K | p95 62 ms, 20 samples | Driver included |
| Settled Blog → Notes folder | p95 97 ms, 20 samples | Driver included; one 277 ms outlier |
| First note open after Home | 464 ms, one sample | Includes lazy code/body work and driver |
| Warm settled note open | p95 105 ms, 20 samples | Driver included; narrowly misses 100 ms |
| Warm note click to reader DOM | p95 44 ms, 20 samples | In-page timing; meets the 100 ms useful-content target at DOM readiness |

An exploratory CPU trace found most of the old immediate-repeat interval idle
while the prior navigation was settling. Disabling the snapshot animation in
that browser tab did not materially change the un-settled median (314 vs
308 ms); waiting for the transition reduced the measured repeat-open time.
No editor or navigation animation was changed to improve the number. The
corrected benchmark is `scripts/bench-content-first.ts`; final log is
`/tmp/texttext-ux-bench-final-2.log`, with exploratory traces in
`/tmp/texttext-ux-note-profile*.log`. The temporary port-3131 server was
stopped and the port confirmed free. This is web Chromium proof, not native
performance, typing latency, a visual-heavy folder, or process-tree memory.
The next cold-open target is under 300 ms on a measured repeated run with a
substantial fixture; profile lazy code and body fetch before changing them.
