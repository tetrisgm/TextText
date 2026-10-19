# Native account sync-attention notice

The native account popover previously showed the account as signed in without rendering supplied sync failure status. A controlled browser using the committed production NativeConnection and AccountMenu reproduced zero notices after a signed-in, not-ready status (`/private/tmp/texttext-native-sync-notice-render-red-second-20261019.log`). This verifies a missing display, not the cause of any actual mirror pause.

The display-only helper now distinguishes an actual `authenticationRequired:true` flag from other sync attention. Only that flag adds the existing Sign in action. Conflict/not-ready status shows a notice while ordinary connecting or legacy missing fields stay quiet; ready status clears stale non-authentication notices. Exact known human recovery instructions may appear, while arbitrary native messages, machine paths, raw JSON and stacks map to “Sync needs attention. Your files are kept on this device.” No universal retry/reopen remedy is promised.

Manual action failures, recovery-copy actions, workspace opening, settings and logout are preserved. No native RPC, transport retry, credential or recovery behavior changes. Windows initial connection snapshots currently omit the authentication flag while failure events carry it; the UI does not infer authentication from a message or status code.

## Evidence

- Relevant pure status/account suites: **13 passed**, `/private/tmp/texttext-native-sync-notice-related-20261019.log`.
- Actual production component controlled Chromium proof passed notice/redaction, actual-flag-only sign-in, preserved manual failure, recovery action and ready-state clearing. Light/dark crops were visually inspected without clipping. `/private/tmp/texttext-native-sync-notice-render-green-20261019.log`; artifacts `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-native-notice-t977Qd/`.
- Private reproduction source: `/private/tmp/texttext-native-sync-notice-render-20261019.mjs`. The first harness build lacked a JPEG loader and did not render; it is not the product regression. The subsequent committed-component run is the meaningful red evidence.
- TypeScript initially failed only an unrelated in-progress fixture, `portable-create-path.test.ts:29`, with missing template default fields. That intermediate log remains `/private/tmp/texttext-native-sync-notice-tsc-20261019.log`. After its owner corrected that fixture, final `tsc --noEmit --incremental false` passed (`/private/tmp/texttext-native-sync-notice-tsc-final-20261019.log`).

No installation, release, live authentication, native-owner UI action or actual transport repair was performed. The normal installed workspace subsequently materialized the new fixture with matching baseline and local hashes; the earlier pause cause remains unconfirmed. That separate runtime observation is not attributed to this uninstalled display change.
