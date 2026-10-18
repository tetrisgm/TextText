# Retained deletion recovery

October 18, 2026. T13 source integration. No installed, hosted or multiplayer acceptance is claimed.

## Shared recovery contract

The recovery entry distinguishes replacement from removal. For removal, the prepared snapshot is the exact expected file before deletion; the displaced snapshot is the actual captured inode. The current path is either explicitly absent or contains exact observed bytes. A recreated foreign or malformed file is inspectable and downloadable, never overwritten by the recovery choice. Missing files are not represented as empty TextPacks.

The shared screen requires all three observations before consent, including explicit absence. It sends the captured kind, presence and nullable current hash. A changed or inconsistent response requires reinspection. The choices are **Keep file deleted** or **Keep current file**; retained alternatives remain downloadable and the editor draft remains mounted. Current foreign/malformed bytes are allowed only for a removal. Older replacement responses retain their strict identity behavior.

## Verification

- `node src/local-vault/__tests__/replacement-recovery.browser.mjs`: exit 0, actual Chromium fixture. Existing replacement/raw-asset assertions plus removal absence, captured nullable consent, foreign recreated current, exact opaque recreated-file download, and invalid absence refusal pass. `/private/tmp/texttext-removal-ui-browser-20261018.log`.
- `npx vitest run src/local-vault/windows-recovery-transport.test.ts`: exit 0, five tests. Explicit absence bypasses pack parsing only for current-version reads; absent prepared responses refuse. `/private/tmp/texttext-removal-transport-20261018.log`.
- `npx tsc --noEmit`: exit 0. `/private/tmp/texttext-removal-ui-typecheck-20261018.log`.

Native capture, crash reconstruction, account scope, one-time user-deletion intent, old-descriptor fencing and native bridge integration remain under implementation and require their own passing gate before delivery.

## Mac native capture checkpoint

Normal user deletion and remote tombstone materialization now use a same-volume exclusive rename into retained workspace storage. The immutable expected snapshot and actual captured inode survive final-gap replacement, interruption and old writable descriptors. Recreated visible files are not removed or rolled back. The registry binds identity, root, principal, operation kind and captured consent. Normal sync/editor operations refuse unresolved captured versions.

User deletion records its intent before capture. Exact completed capture reconstructs immutable globally visible Trash exports before a one-time deletion marker. Durable publication/intent-cancellation flags prevent consumed or restored older intentions from being reissued on later reads. Recovery inspection is read-only. A pre-capture interruption with unchanged original bytes cancels the unexecuted operation without a marker. Unknown pre-capture disappearance still refuses; unique-rename recovery is the next bounded follow-up.

The stress-flag native gate passed: app 50 tests with 4 opt-in skips, FileProvider 194 with 6 opt-in skips, CLI 40, no failures. It includes seven removal regressions (actual opaque displacement, foreign recreated current, safe pre-capture cancellation, marker reconstruction/consumption, restore then new deletion, late old descriptor, ambiguous identity). Command: the Swift filter in `scripts/test-sync.sh`, with `TEXTTEXT_STORE=1 TEXTTEXT_VAULT_HTTP_TEST=1` and `-Xswiftc -DTEXTTEXT_STRESS_ACTOR`. Log `/private/tmp/texttext-retained-removal-native-first-20261018.log`, exact changed source hashes `/private/tmp/texttext-retained-removal-native-first-20261018-source.json`.

The native bridge serializes absent current files explicitly as null bytes/hash; present snapshots remain exact packs or opaque bytes. A private actor accessor also verifies its captured account and expected folder, including token refresh, changed-account refusal and legacy-window refusal. The actor itself is under a separate source-attestation change. Windows retained removal and actual installed recovery journeys remain open.
