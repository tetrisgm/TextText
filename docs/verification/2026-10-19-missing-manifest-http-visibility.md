# Missing manifest visibility: native HTTP boundary

Isolated diagnostics against frozen `825433cfe7c0267056a1f2a30c81b8e830948b7f` passed on Mac and actual Windows. These use production HTTP transports with controlled URLProtocol/HttpMessageHandler responses, not live authentication or installed-app acceptance.

Both fixtures first download a valid pack, then return a successful manifest omitting its ID without a tombstone. Full-access/create and filtered/no-create variants both deny `canWrite(existing: true)`. Neither dispatches a mutation; the existing projection, baseline and outbox survive another sync and a fresh-engine restart. Create permission remains independently true only in the full-access variant.

- Mac: `MissingManifestVisibilityTests`, one test covering both modes, zero failures/skips; 0.989 seconds. Evidence: `/private/tmp/texttext-missing-http-mac-prepared-20261019-i46udxg4/{input.json,result.json,exit.json,swift.stdout.log}`. Archive lock restored; owner `Package.resolved` remains SHA `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.
- Windows: ten assertions, fresh isolated archive and private Program branch, not full Core runtime. Evidence: `/private/tmp/texttext-missing-http-pc-prepared-20261019-4j81pklu/result.json` and adjacent build/runtime logs. All 3,223 source inputs before/after match SHA `87f86542172504fcaf106e2929c93d3220c12fb2ac6a9ad1cddddd76536daee1`; result records compiled Core/test/host hashes.

The earlier Mac fake-transport recreation expectation explicitly supplies existing-item write authority. It does not establish a production missing-item divergence. No missing-item policy or production behavior changed. Folder-baseline item-limit differences remain a separate unproven scale question.
