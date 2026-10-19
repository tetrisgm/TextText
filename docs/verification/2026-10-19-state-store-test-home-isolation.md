# StateStore test home isolation

Four test files redirect only FileManager's Application Support/user-domain URL lookup to owned temporary roots. Real copying, permissions and other filesystem APIs remain inherited. All 28 existing constructor sites explicitly supply the fixture manager, group and CLI destination; four owned CLI handshake positives retain their explicit targets. Production StateStore is unchanged.

The constructor witness seeds two owned legacy files, verifies the URL lookup, exact copied/source bytes, credential mode 0600, and no overwrite of newer existing target bytes. Existing chooser/security tests and environment restoration remain intact. No actual-home reproduction was attempted.

## Verification

- Scratch: 41 passed, no skips/failures, on base `6a78ef0844a4704d8108c40680728289707925aa` plus four test overlays. The first scratch compile failure (Workspace? compared with Data) is preserved; the witness was corrected to compare raw cache bytes.
- Main: 41 passed, no skips/failures: StateStoreLocation 17, AppHealthReporter 15, LegacyAccountIdentityRefresh 3, AppGroupContainerChoice 6. Log: `/private/tmp/texttext-state-store-main-isolation-20261019/isolation-gate-final.log`.
- Four test hashes matched before/after the main gate. Owner Package.resolved restored exactly to `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.
- After gate exit, one stale test comment was corrected to describe the owned legacy directory. This comment-only hash delta is recorded separately in the manifest; executable code did not change after verification.

No normal application, actor campaign, installation, production state, or real-home migration was exercised by this change.
