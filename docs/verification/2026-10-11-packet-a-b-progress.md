# Packet A and B progress

Date: October 11, 2026. Source checkout: `main` at `4f51d0dd` before the local durability fix.

## Packet A: Windows candidate and SSH diagnosis

- The previous Windows build folder named in the handoff was absent. Its replacement folder had no Git metadata, and its source fingerprint (`e3701eef…`) did not match `main`. A fresh archive of `4f51d0dd` fingerprinted `b5057f2b81a8ba9b20f80b4bb8c50949e0e2c38583ffd8aa9fd312e604daa420` and was built in `C:\Users\Shokunin\dev\texttext-packet-a-4f51d0dd`.
- Windows native core, startup, agent, 400 shared-client tests, TypeScript, UI build, publish, and native desktop smoke passed. The smoke covered duplicate activation during open, durable activation flush, close during activation, and close after durable flush. Receipt: `C:\Users\Shokunin\dev\texttext-packet-a-4f51d0dd\windows\build\smoke-receipts-ee9be7e4838a404ea07a7d3288f4b7d4`.
- Mac installed identity reread October 11: TextText 0.204 (1259), executable SHA-256 `1e74268b05aacae656171a9c38ef250dad3e0448498200b82b3401d4a94bffbc`, executable mtime 2026-10-11 6:34:44 PM PDT. This identifies the installed binary only; it does not prove the installed app has the latest local source.
- Read-only hosted identity check of `https://texttext.app/api/app/build` returned `texttext-oracle-20261011T180600Z-136bc176`. This is the production web build currently answering requests; the local source is ahead and has not been deployed.
- Sealed candidate `candidate-5cd457c3f34542f08db6a2129c1448d5` was installed through `windows/scripts/install.ps1`. The prior install was retained at `C:\Users\Shokunin\AppData\Local\Programs\TextText-previous-20261011T205029-100d7e63`. Installed and sealed `TextText.exe` hashes match: `8eaf0eb49815a8c12240c408b20a8d88d6d36a8bce2382692e86e629cc56c37f`. Installed receipt verification passed.
- After install, the app was absent; launching the installed executable started PID 7440 at 8:56 PM from `C:\Users\Shokunin\AppData\Local\Programs\TextText\TextText.exe`. This confirms process startup only; existing-workspace and ordinary-use checks remain open.
- The recurring SSH failure was Windows account lockout triggered by WebView2 bad-password attempts. The prior username and group-matching diagnoses were incomplete. Original SSH settings are restored. A persistent WebView2 feature policy passed 18 fresh environment launches with no failed logons or lockouts; see [root-cause evidence and receipts](2026-10-11-windows-account-lockout.md).
- Historical runs 171–174 still need a narrow explanation for the earlier rejected flush. The controlled native ordering tests now pass and the candidate is installed, but those failures remain preserved; do not infer general sync reliability from run 176.

## Packet B: transactional browser persistence

- Browser journals now use one versioned IndexedDB record per owned collaboration journal. Strict transaction durability is requested where supported; browser persistent storage is requested when available. The localStorage copy remains as a migration/recovery fallback and does not grant a durable acknowledgement.
- Legacy migration validates both copies, chooses the newest valid generation, commits it transactionally, and reads it back before use. An aborted migration preserves the old bytes. IDB enumeration keeps journals discoverable when the localStorage mirror hits quota. Outbound pushes and browser navigation wait for a stable committed generation; native checkpoints remain an independent success path when browser storage fails.
- Blocked IndexedDB open and unsupported stored schema fail closed while preserving the legacy copy or IDB record. Aborted migration preserves the old bytes and a later startup recovers them. Browser bootstrap checks IndexedDB before switching to local editing mode.
- Typed outcomes carry workspace, item, lifecycle and generation through navigation. A native-only hook passes `{ ok, durability }` to both native shells; the Windows guard requires a durable outcome and retains the typed fields, and the Mac controller records the result. The sign-out hook remains boolean for the web flow.
- Focused collaboration/navigation suites: 97 passed. TypeScript and `swift test --package-path mac --filter testNativeCloseRequiresTypedDurableResult` passed. Real Chromium epoch-adoption confirmed the committed IndexedDB record and retained recovery after native checkpoint rejection. `npm run test:sync:client`: 406 passed, exact-source receipt generated.
- The first typed Windows smoke caught case-sensitive result deserialization; the close guard failed safely. After correcting the mapping, Windows WebView smoke passed, including typed-generation retention, failed flush, retry, close-during-activation, and duplicate activation. Failure receipt: `C:\Users\Shokunin\dev\texttext-packet-b-e49d4719\windows\build\smoke-receipts-3271d9cf18c14d5ebcbcce482bcc828c`; passing receipt: `C:\Users\Shokunin\dev\texttext-packet-b-e49d4719\windows\build\smoke-receipts-c4e661f2ada74a9fbe4bf2256e9359bf`. Browser eviction or explicit site-data deletion can still remove browser-owned storage; denied persistent-storage requests do not block use after an IDB transaction commits.
- Server collaboration tests: 29 passed, including durable receipt replay after the audit callback fails post-commit. A Mac native-result unit test accepts only the typed `durable` outcome. The [ordering contract](collaboration-durability-ordering.md) records the present atomic-file/intent guarantees and remaining crash boundaries.
- The initial post-fix build was interrupted by the SSH/account-lockout fault. The later full candidate passed and was installed; see the follow-up below.

## Next actions

1. Verify ordinary use of the newly installed Windows candidate with the existing workspace; preserve every file and recovery journal.
2. Complete adapter conformance and crash-boundary fixtures; keep localStorage bytes until migration failure coverage is complete.
3. Continue the acceptance matrix only after the applicable shared durability gates pass. Keep failed runs 171–174 and asset conflict run 89 as failures.

## Follow-up: typed native durability boundary

- The typed durability response is now required to carry nonempty workspace, item, and lifecycle identifiers, a nonnegative generation, and `outcome: durable` before either native shell releases its close guard. This closes a gap where an incomplete object containing only the durable label could pass the native boundary.
- Verification: full `npm run mac:test` passed, including the typed close-gate test. `dotnet run --project windows/TextText.Agent.Tests/TextText.Agent.Tests.csproj` passed the portable Windows renderer guard checks, including missing fields and malformed field types, and the existing agent checks. These checks exercise the native decision code; they do not replace the WebView2 desktop smoke or an installed Windows candidate.
- The full post-fix Windows build passed all required checks and sealed `candidate-dcaff9307bab48ac87f67791ec698b16`. Its source fingerprint matches a pristine archive of `01745e4e`. Installation verified the candidate and preserved rollback. Two further desktop smoke runs passed while auditing the WebView2 lockout workaround; [candidate and infrastructure receipts](2026-10-11-windows-account-lockout.md).
