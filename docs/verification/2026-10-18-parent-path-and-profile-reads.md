# T12/T17 parent paths and concurrent profile reads

Final-hook fixtures reproduced parent symlink substitution causing the Mac replacement/removal helper to touch an outside fixture file, and nested stable profile verification incorrectly refusing as busy. The three failing assertions are preserved in `/private/tmp/texttext-shared-verify-parent-symlink-red-20261018.log`.

Canonical syscall paths are now captured before the final hooks and used with RENAME_NOFOLLOW_ANY, so a replaced parent refuses without following its symlink. Stable profile attestation uses a shared root-private read lease; reconstruction releases it, acquires the exclusive lease, and rechecks before mutation. Prepare remains exclusive. Operation-bound deletion markers also reject unknown or missing bound fields while retaining supported legacy marker behavior.

The focused Helper/Removal/Profile selection passes 35 tests with the stress actor compilation flag. Log `/private/tmp/texttext-shared-verify-parent-symlink-green-20261018.log`. The pending durable move red fixture is excluded from this checkpoint. No installed acceptance or general power-loss guarantee is claimed. Package.resolved original bytes were restored.

## Verified source SHA-256

- `mac/Sources/TextTextFileProviderKit/LocalVaultDeviceState.swift`: `91a5e89f4dd79906b4495b1e185e0ad701dfb5f0f35028a86c31bb94107d7c09`
- `mac/Sources/TextTextFileProviderKit/RetainedFileReplacement.swift`: `698e7650c934db25bb1d3f3630e707d461c3d91cee6f6f36ce342ff0179100b5`
- `mac/Sources/TextTextFileProviderKit/RetainedFileRemoval.swift`: `5532e242216d6ef2404f16b1d9c6b7fdbe9ef98a8c15c6ae8ad06a0b18843cf1`
- `mac/Sources/TextTextFileProviderKit/RetainedReplacementProfile.swift`: `823cee123da3c8a4d0d71dc95c7ca0002571d5bbecc39ee50c2362b2873eb893`
- `mac/Tests/TextTextFileProviderKitTests/RetainedFileRemovalTests.swift`: `302f79767d9089f1f45029caafa6f6f4cd10bc10df250b02fcdf739df2ecd401`
- `mac/Tests/TextTextFileProviderKitTests/RetainedReplacementProfileTests.swift`: `c1c6d1d5204c3c6ba573ac5f4f34dc77d00a13a5aac74ffe405dc4d48389ba02`
