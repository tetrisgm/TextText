# Mac queued upload path adoption

The Mac adapter now asks the [packaged queued-upload path policy](2026-10-19-queued-upload-path-policy.md) before reissuing an existing queued upload at a different authoritative server path. Same-path sends, new creates and non-upload operations retain their existing owners. There is no native eligibility fallback or new persisted format.

Reissue requires the configured private owner, exact principal/root/server/workspace binding, known matching pending/baseline/server generations and revisions, actual staged hash plus item identity, one current local projection, permission and no conflicting recovery work. Native facts include the full target command, baseline, binary acknowledgements, saved/folder/pull work, deletion evidence, checkpoint/journal/intents and projection bytes. Memory must agree with the durable target before metadata preparation. All throwing setup and awaits share one checked boundary; changed or unreadable durable target aborts the pass before its final whole-State save. Error replies and false permissions are revalidated too.

A deferred original operation ID is excluded from send, per-item reconciliation, remaining-queue eligibility and lifecycle stamping for this pass, then cleared on every exit. Stable deferral does not request an immediate further pass. A retained original reports: “A queued file update needs review before its path can change. Your file is kept on this device.” Reissue allocates a fresh ID only after revalidation, copies the captured payload and uses the existing file CAS/move and State writer. The old payload is cleaned only after the replacement is durable; failed persistence restores the actor’s original command and retains recoverable bytes.

## Evidence and boundaries

- The original controlled deletion-intent RED remains preserved. The first integrated regression passed; expanded fixtures then verified complete target records, actual staged payload bytes/names, deletion/private editing evidence and both projection paths after deferral and fresh-engine restart.
- Source-review findings closed missing ownership, initial memory/disk disagreement, account/binary-ACK changes and save-after-error gaps. These are current negative regression proofs, not claimed historical causal REDs.
- Four unchanged older queued-positive tests produced actual REDs: `/private/tmp/texttext-mac-queued-legacy-red-20261019.log` and its metadata directory. They lacked owner/scope/generation evidence. Positive fixtures now use a production private owner, explicit transport authority and native adoption of an actual known-generation pack.
- Lost upload ACK followed by a peer path move has server revision equal to staged content, but different from the request’s original base. That is not a terminal receipt. Its exact pending record, staged bytes, baseline, private work and local copy remain unchanged across restart with zero extra RPC. The previous replay expectation is explicitly replaced by retained review. No cancellation or receipt lookup protocol was added.

Controlled native/source verification only. No installation, live profile/account mutation or physical cross-device acceptance is claimed.

## Final frozen gates

- Focused: **30 passed, zero skips** (26 queued-adoption cases plus four modernized existing cases), `/private/tmp/texttext-mac-queued-path-boundary-final-focused-20261019.log`.
- Broader exact current Swift-only sync lane: **498 tests, 11 explicit skips, zero failures**. All 42 required suites had actual passed cases. Verifier 13 and Windows wire 2 Node checks also passed. The existing optional WK/volume/helper/performance skips remain explicit; every name/reason is recorded in the summary below.
- All 265 guarded Swift/source-script paths remained identical before/after, including the current test-sync selection, HTTP fixture and verifier inputs. Exact owner Package.resolved bytes were restored, SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.
- Broad log: `/private/tmp/texttext-mac-queued-upload-path-broad-swift-20261019.log`, SHA256 `f2c43d80ec1192875c52def764b52ffabed76c4b5fe82a46f2fbcf04235c9065`.
- Full before/after hashes: `/private/tmp/texttext-mac-queued-upload-path-broad-swift-result-20261019.json`; counts, skip names and evidence hashes: `/private/tmp/texttext-mac-queued-upload-path-broad-swift-summary-20261019.json`.

The finite matrix includes source-review ownership/account/binary-ACK guards; initial stale memory/disk target; earlier manifest mutation plus unsafe projection setup; held-policy local/remote/permission/intent/payload mutations; mutation combined with policy failure, manifest failure or final permission denial; and unchanged-target transient errors returning retained review. Changed durable targets preserve full raw State bytes by aborting before tail save. Unrelated global cache bytes are not claimed invariant.
