# Mac profile migration lease

Both profile preparation and verification acquire the same device-private, nonblocking migration lease. Contention refuses before reconciling an active owner exchange; unlocked internal helpers avoid nested acquisition.

The deterministic nested prepare/verify fixture failed before the change (four assertions): `/private/tmp/texttext-profile-concurrent-prepare-red-20261018.log`. After the fix, the required Swift selection from `scripts/test-sync.sh`, with `TEXTTEXT_STORE=1`, `TEXTTEXT_VAULT_HTTP_TEST=1`, and `-DTEXTTEXT_STRESS_ACTOR`, passed with exit 0. FileProvider ran 204 tests (6 opt-in skips), CLI 40, and the app selection also passed. Log: `/private/tmp/texttext-profile-migration-lease-native-final-20261018.log`.

This is source verification, not installed or physical acceptance. The pre-existing Package.resolved bytes were restored after compilation.

## Verified source SHA-256

- `mac/Sources/TextTextFileProviderKit/RetainedReplacementProfile.swift`: `470aeec122deda0403fca1948c88dc6c80b85846861031e2886bc9aced7d4b00`
- `mac/Tests/TextTextFileProviderKitTests/RetainedReplacementProfileTests.swift`: `2167cf65e871c81ea75bb29f9c4f21ab4f34aaf947ab56d3e91a46671fc5c433`
