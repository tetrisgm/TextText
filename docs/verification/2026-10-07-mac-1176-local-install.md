# Mac 0.204 (1176) final local installation

Source `1048ba24`, built from clean snapshot `/tmp/texttext-final-1048ba24` using the established local Store workflow. Native Apple sign-in, Apple Development signing, existing Codex 0.153.4, account and iCloud workspace were preserved. This was a one-off local installation, not a public release.

## Relevant checks

- Required exact-source sync gate: 234 shared tests passed and native receipt passed. Targeted clean detached-file regression: 44 collaboration-client tests passed; TypeScript passed.
- Swift release compilation and normal App Intents generation passed. Code signature verified with `codesign --verify --deep --strict`.
- All three signed extensions remain installed and registered: Quick Look, File Provider and Share.
- The established installer verified version/build and binary signatures; it used the documented sandbox-private runtime-health exception. No passing runtime health attestation is claimed.
- Before installation, the app was idle in read view with the agent task completed and no unsaved input. Command-Q quit normally before replacement.
- Installed build 1176 reopened the signed-in iCloud workspace and test note. A further normal Command-Q terminated the process; reopening rendered the same note and all eight markers, including `Windows ACK refresh verification 20261007.` arriving from the concurrent Windows test. No Mac content edits were made in this check.

The narrow fix permits leaving a saved external file while upload is pending only after a valid fresh read and successful clean-journal retirement. Real collaboration-client regressions cover clean retirement, pending edits, unreadable journals, journal-removal failure and stale file identity. The Mac check above proves normal close/reopen; the disconnected external-file case is covered by those regressions, not claimed as a separate physical offline test.

## Installed SHA-256

- `Contents/MacOS/TextText`: `fcf6609ecfa1ecd6b45ac6ef95ab04cf2fe99050f8734810eb6117d296ae2554`
- `Contents/Resources/LocalVault/app.js`: `2cc46f4390617f6330c702c2b443252e843038570b09bcbabebc6b55e2b1b790`

Logs: `/tmp/texttext-mac1176-build.log`, `/tmp/texttext-mac1176-install.log`, `/tmp/texttext-detached-flush-test.log`.
Earlier live model editing and agent presence evidence: [1175 receipt](2026-10-07-mac-1175-agent-presence.md).
