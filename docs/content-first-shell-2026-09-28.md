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
