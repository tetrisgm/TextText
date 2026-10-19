# Mac clean-checkpoint naming debt

This is a reviewed-source preparation receipt, not an installed fix or rename acceptance claim. The [1272 installed receipt](2026-10-19-mac-1272-image-template-acceptance.md) preserves the actual image/template passes and subsequent filename reversion. Existing user files were not changed by these tests.

## Reproduced boundary

A pristine frozen `af7e9325a684d5d1bfb2e1108b41763dcc88bd2a` scratch source (3,298 files, input SHA256 `b792286a75bdbc4749b72a6df5a63bfa9b943bcecfe0f61a9f1a159a7eb39040`, archive `44939de1c07dc4ee7fe81f7dfbe4f0ca56fb96a4840823d9b28cfca91615fb4f`) received only two named source/test overlays. Actual production root ownership, lifecycle adoption, retained `DocumentStore.rename`, checkpoint materialization and separate fresh-engine restart were used with controlled transport replies.

The unchanged-production RED ran three cases: pending-close control passed, while known- and unknown-generation clean-close cases failed seven intended assertions. Closing before any mirror rename announcement stamped the rebased checkpoint filename into the sync baseline. A later cycle interpreted the unchanged old server path as a peer move and restored the old local name. This proves the native control-flow defect; missing generation in the actual installed fixtures remains an independent admission limitation, not invented known-generation evidence.

The first attempt failed because the isolated test process lacked `tsx`; that setup log is preserved and is not counted as the product RED. After locked dependencies, `red-swift-with-deps.log` contains the meaningful failures with zero unexpected errors.

## Narrow proposed change

Three clean-checkpoint content-baseline updates retain an existing baseline filename while advancing the acknowledged content revision/hash; only an absent baseline falls back to the checkpoint path. An exact clean, nonretired, uniquely identified unchanged projection with an unresolved filename difference stays under the existing shared path/saved-move policy. Known generations can announce the immutable move. Unknown generations hold without dispatch or filename reversal. No ordinary-queue fallback or invented lifecycle is used. The separate recovery protocol was not changed.

A separate readiness RED established that static collaboration readiness rejected this exact retained clean projection although native begin/checkpoint could reopen it. The narrow readiness branch now requires the existing private principal, journal account/protection, prior different baseline path, exact checkpoint/local hash and unique same identity, and absence of outbox/conflict/retirement/intent fences. This authorizes reopening retained content, not server naming acknowledgement. Normal readiness follows existing replacement-registry checks, which can perform their supported repair; it is not advertised as a pure observer.

## Verification

Strict focused matrix: nine tests, zero skips/failures. It includes the three naming cases, fresh unknown-generation readiness/begin/checkpoint, genuine peer remote move, existing clean content ancestor/external edit, clean retirement and active peer folder move. New readiness negatives cover wrong principal/root, foreign journal account, duplicate identity, changed hash, retired checkpoint, actual retained native intent, outbox and conflict. Only explicitly allowed typed refusals are accepted; unexpected errors fail the test. An earlier assertion-harness mistake and its correction remain in separate logs.

Full affected `TextTextFileProviderKitTests` lane: 566 reported tests, 11 explicit optional/helper skips, zero failures/unexpected failures. HTTP contract fixtures used the guarded local database and fresh af7 policy bundle. All 3,298 tracked scratch inputs matched before/after the final gates, including the exact two overlays. Scratch Package.resolved was restored exactly, and the owner's package SHA256 remained `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.

Evidence root `/private/tmp/texttext-clean-shared-rename-red-af7-20261019/`:

- `strict-focused9.log`: SHA256 `6f532529035fa33db44ff36d2662f8c0bd8a0244a0df6b650a7fcc4f4a57791a`.
- `full-affected-kit.log`: SHA256 `dab8af02b825abde369e85dc90aaa0dcd5839eaeaf4cf4c278ff76a60901480e`.
- `final-gate-result.json` records actual commands, times, exits and source/lock guards.
- `final-review-manifest.json`: SHA256 `64f30f9347f23986f4a61cd8068930d9feb5785e3cfbd0a5071056c4ee2c9f39`; includes all failed-attempt log hashes and exact before/proposed source hashes.
- `LocalVaultSync.swift.review.diff` and `LocalVaultSharedEditingTests.swift.review.diff` are the exact two-path review patch.

At the scratch-review boundary, no main-source copy, candidate build, installation, fixture rename retry or six-client acceptance had been performed. Unknown-generation naming remains held; server deployment alone does not manufacture a lifecycle for existing fresh items.

### Explicit full-Kit skips

- `TextTextFileProviderKitTests.LocalHandoffProfileTests testActualPreviousCLIRefusesPrivateFloorFourBeforeWriting`
- `TextTextFileProviderKitTests.LocalVaultAccountStateAdoptionTests testDiskFullAdoptionRetainsOriginalsAndResumes`
- `TextTextFileProviderKitTests.LocalVaultAccountStateAdoptionTests testResumeInSeparateProcess`
- `TextTextFileProviderKitTests.LocalVaultPhysicalProviderTests testRealICloudDuplicateDeliveryAndHTTPReconnectRemainIdle`
- `TextTextFileProviderKitTests.LocalVaultPhysicalProviderTests testRealICloudEvictionDoesNotBecomeDeletion`
- `TextTextFileProviderKitTests.LocalVaultSharedEditingTests testCheckpointNoSpacePreservesPriorGenerationAndRecovers`
- `TextTextFileProviderKitTests.LocalVaultSharedEditingTests testHoldDocumentInOwnedChild`
- `TextTextFileProviderKitTests.ReplacementRecoveryRegistryTests testOneThousandDocumentIdentityLookupCampaign`
- `TextTextFileProviderKitTests.ReplacementRecoveryRegistryTests testOneThousandRetainedSavesUsePersistedFingerprintAttestations`
- `TextTextFileProviderKitTests.SharedRenameProfileTests testOwnedPublicationProcess`
- `TextTextFileProviderKitTests.SharedRenameProfileTests testProducePreviousFactoryFixtures`

## Current-main verification after reviewed copy

The exact two reviewed files were copied after both main-file hashes matched their recorded bases. Current main was `f5292d6b187a4ee9ded04d804ab44aee600dc57c`; the proposed source hashes above remained exact. A freshly built current-main policy/UI bundle with all nine vector fixtures and the guarded local database was used.

- Strict focused lane: 9 passed, no skips/failures.
- Full affected Kit: 566 reported tests, the same 11 explicit skips listed above, no failures/unexpected failures.
- All 3,309 tracked main inputs matched before/after; owner Package.resolved was restored to the exact SHA above. Both child commands exited zero and all children exited. No candidate build or install was performed.

Evidence root `/private/tmp/texttext-clean-shared-rename-main-gates-20261019/`:

- `strict-focused9.log`: SHA256 `e80bb849857dd44a91f24bddfac1018f7787f9f48cb90b6df9169aa9eaf676be`.
- `full-affected-kit.log`: SHA256 `c5c8d33a05286442901ede5979d7e3a811fbeb5ecae63003808f78af13f5fe75`.
- `final-gate-result.json`: SHA256 `5b75c45d8b1c3d107a386db0206d27dd9f88477138f566c9fa0e1cb24f6bea21`. Its retained `sourceCommit` field names the af7 base/helper provenance; it is not the actual main HEAD. `main-attribution.json` explicitly records current-main attribution without changing that original evidence.
