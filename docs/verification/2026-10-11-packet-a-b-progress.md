# Packet A and B progress

Date: October 11, 2026. Source checkout: `main` at `4f51d0dd` before the local durability fix.

## Packet A: Windows candidate and SSH diagnosis

- The previous Windows build folder named in the handoff was absent. Its replacement folder had no Git metadata, and its source fingerprint (`e3701eef…`) did not match `main`. A fresh archive of `4f51d0dd` fingerprinted `b5057f2b81a8ba9b20f80b4bb8c50949e0e2c38583ffd8aa9fd312e604daa420` and was built in `C:\Users\Shokunin\dev\texttext-packet-a-4f51d0dd`.
- Windows native core, startup, agent, 400 shared-client tests, TypeScript, UI build, publish, and native desktop smoke passed. The smoke covered duplicate activation during open, durable activation flush, close during activation, and close after durable flush. Receipt: `C:\Users\Shokunin\dev\texttext-packet-a-4f51d0dd\windows\build\smoke-receipts-ee9be7e4838a404ea07a7d3288f4b7d4`.
- Sealed candidate `candidate-5cd457c3f34542f08db6a2129c1448d5` was installed through `windows/scripts/install.ps1`. The prior install was retained at `C:\Users\Shokunin\AppData\Local\Programs\TextText-previous-20261011T205029-100d7e63`. Installed and sealed `TextText.exe` hashes match: `8eaf0eb49815a8c12240c408b20a8d88d6d36a8bce2382692e86e629cc56c37f`. Installed receipt verification passed.
- After install, the app was absent; launching the installed executable started PID 7440 at 8:56 PM from `C:\Users\Shokunin\AppData\Local\Programs\TextText\TextText.exe`. This confirms process startup only; existing-workspace and ordinary-use checks remain open.
- SSH root cause is a username mismatch, not a sleeping PC or a bad key. Windows `OpenSSH/Admin` logged `ga_init, unable to resolve user shokunin` and `get_user_token` failures at 8:09–8:16 PM. That short username is not the PC's local account. The Mac's existing `pc` and `pc-tunnel` aliases both specify `desktop-bakiemj\\shokunin` and the existing `~/.ssh/id_ed25519`; both were verified with `whoami` at 8:52 PM. Windows `OpenSSH/Operational` confirms public-key acceptance with fingerprint `SHA256:IdUKq/h9ZNmmxFgWeCWadBLC3j+aAIC+yj5c7ecicL8`. Later “disconnected by user” events are normal client closes after commands return. Use the configured aliases; no sshd or account changes are indicated.
- Historical runs 171–174 still need a narrow explanation for the earlier rejected flush. The controlled native ordering tests now pass and the candidate is installed, but those failures remain preserved; do not infer general sync reliability from run 176.

## Packet B: failed browser persistence

- Reproduction added to `src/local-vault/collaboration-client.test.ts`: after the journal store rejects a local edit, `flushLocal()` returned `true` without a native checkpoint. The focused test failed with the observed `true` before the fix.
- The client now acknowledges a browser generation only after `save()` returns successfully. A later flush retries a transient failed save. Native checkpoint success remains a valid local durability boundary even when browser storage fails. `flushLocalResult()` exposes workspace, item, lifecycle, generation, and typed outcome; native navigation uses the typed result when available.
- Focused collaboration/navigation suites: 93 passed, including uninitialized and rejected-native-checkpoint outcomes. TypeScript passed. `npm run test:sync:client`: 402 passed, exact-source receipt generated.
- Packet B remains open: the browser adapter is still synchronous `localStorage`; versioned IndexedDB/transaction behavior and migration preservation are not implemented. Serialization/size, quota, initial-empty/restored-state, and interruption matrices remain to be completed. The result type is an initial boundary, not completion of the storage contract.

## Next actions

1. Finish packet B with the persistence adapter, migration/failure tests, and typed outcomes through all relevant native/browser boundaries.
2. Reopen and use the installed Windows candidate against the existing workspace; preserve every existing file and recovery journal.
3. Continue the acceptance matrix only after the applicable shared durability gates pass. Keep failed runs 171–174 and asset conflict run 89 as failures.
