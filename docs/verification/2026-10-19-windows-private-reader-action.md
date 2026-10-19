# Windows private actor reader action

The prior private actor looked only for `Edit card`; the real article reader exposes scoped `Edit story`. This changes only the private actor transition and links its helper into the controlled Smoke executable. Normal product UI and selected-item, account, shared-ready, and continuity checks are unchanged.

## Verification

- Frozen diagnostic base `4e0cbd83d3f0d0e2073e783b142f4def425b6ba4`, with the five named reader/test paths in `/private/tmp/texttext-pc-reader-action-jpzthvso/input.json`. Dedicated PC scratch has the same basename. No candidate source patch or installed app change.
- Actual Windows Smoke and private LiveAcceptance builds passed. A single interactive WebView2 controlled-DOM session reproduced the old card-only article refusal and passed **38 assertions**: note/article readiness without a click, activation retaining the same DOM, no repeat click, existing editable-body acceptance, and absent/unrelated/disabled/aria-disabled/hidden/inert/invisible/ambiguous refusal.
- The helper JavaScript exactly matches the reviewed Mac private reader helper. Only one visible enabled production-scoped action is accepted.
- `desktop-smoke.log`, `reader-action.json`, compile logs, and safety/task/cleanup receipts are retained in that evidence directory. This is controlled engine verification, not a live actor bootstrap or six-client acceptance.
- Safety interval began `2026-10-19T11:01:11.4428244Z`; postflight at `11:03:00.3518400Z` found zero matching Shokunin 4625/4740 events. Existing mitigation was present; normal PID33756 retained its exact start/executable hash and was responding. No account adoption or normal owner binding was performed.
- Owned scheduled task was unregistered; no owned Smoke/dotnet or matching WebView2 processes remained. The temporary disposable profile directory was retained after the normal cleanup encountered a sharing delay. No force termination was used.

The already sealed actor source4e remains an intermediate artifact with the known selector limitation; final runtime bootstrap requires a fresh seal from the committed corrected actor source. Installed product remains a041; driver seals remain4c.
