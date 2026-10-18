# Retained deletion recovery

October 18, 2026. T13 source work in progress. No installed, hosted, native-removal or multiplayer acceptance is claimed.

## Shared recovery contract

The recovery entry distinguishes replacement from removal. For removal, the prepared snapshot is the exact expected file before deletion; the displaced snapshot is the actual captured inode. The current path is either explicitly absent or contains exact observed bytes. A recreated foreign or malformed file is inspectable and downloadable, never overwritten by the recovery choice. Missing files are not represented as empty TextPacks.

The shared screen requires all three observations before consent, including explicit absence. It sends the captured kind, presence and nullable current hash. A changed or inconsistent response requires reinspection. The choices are **Keep file deleted** or **Keep current file**; retained alternatives remain downloadable and the editor draft remains mounted. Current foreign/malformed bytes are allowed only for a removal. Older replacement responses retain their strict identity behavior.

## Verification

- `node src/local-vault/__tests__/replacement-recovery.browser.mjs`: exit 0, actual Chromium fixture. Existing replacement/raw-asset assertions plus removal absence, captured nullable consent, foreign recreated current, exact opaque recreated-file download, and invalid absence refusal pass. `/private/tmp/texttext-removal-ui-browser-20261018.log`.
- `npx vitest run src/local-vault/windows-recovery-transport.test.ts`: exit 0, five tests. Explicit absence bypasses pack parsing only for current-version reads; absent prepared responses refuse. `/private/tmp/texttext-removal-transport-20261018.log`.
- `npx tsc --noEmit`: exit 0. `/private/tmp/texttext-removal-ui-typecheck-20261018.log`.

Native capture, crash reconstruction, account scope, one-time user-deletion intent, old-descriptor fencing and native bridge integration remain under implementation and require their own passing gate before delivery.
