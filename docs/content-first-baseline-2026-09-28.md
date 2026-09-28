# Content-first production baseline, September 28, 2026

This is a baseline of the existing interface before the content-first visual edits, not an acceptance result. It uses source `9737093b` plus four earlier local commits on `main`, the production Next.js 16.3.4 build in `.texttext/ux-baseline-build`, local Postgres, and Chromium against the existing `visual-demo` workspace (`Mira Chen`). The machine is an Apple M4 Mac with 16 GiB RAM on macOS 27.0. The installed local Mac app is a separate 1.0 (1095) development-signed build and is not represented by these web timings.

The production preview ran on port 3131 and was stopped afterward. The installed app's existing port-3000 development server stayed running. `scripts/bench-content-first.ts` used a fresh browser context, then 20 warm Command-K and Notes-folder samples and ten warm opens of the existing `Codex capture verification` note. Durations include Playwright driver overhead and end at DOM visibility/focus, not compositor or image decode. The Home view has a small mixed fixture with older performance notes and links; it is not the substantial visual or 5,000-item workload required for final acceptance.

| Interaction | Result | Limit |
| --- | --- | --- |
| First Home item visible after one new page navigation | 1,604 ms | One cold-ish sample; no p95 claim |
| Warm Command-K focused | median 35 ms; p95 50 ms; max 197 ms (20) | Driver included |
| Warm folder switch to Notes | median 58 ms; p95 88 ms; max 150 ms (20) | Selected folder and page visible; driver included |
| Warm note open | median 311 ms; p95 403 ms; max 403 ms (10) | Misses the brief's 100 ms target; driver included |

The earlier `scripts/bench-workspace-matrix.ts` could not start its measurement because it waits for `.workspace-item-option` on Home, while the current Home uses `PersonalHome` timeline buttons. That failure is in `/tmp/texttext-ux-baseline-interactions.log`; it is not a performance pass. The new bounded probe passed and its output is `/tmp/texttext-ux-baseline-current.log`. The production build passed; log `/tmp/texttext-ux-baseline-build.log`.

At the boundary, `memory_pressure -Q` reported 45% free before the build and 42% after the probe. The temporary production Next server PID 17480 showed 19,584 KiB RSS and was stopped. These figures are not whole-app process-tree memory or a leak test. Typing with concurrent collaboration, visual-heavy folders, cold native launch, idle CPU, repeated open/close memory, active agent work, and two-session mutation timing remain unmeasured. Run those on realistic fixtures before acceptance. Provisional improvement target for this same small fixture is a warm note-open p95 below 100 ms; document the cold launch target after repeated cold runs.
