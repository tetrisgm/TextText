# Disposable real iCloud provider check

October 18, 2026. Bounded T15 evidence, not complete provider acceptance or an installed app claim.

`LocalVaultPhysicalProviderTests.testRealICloudEvictionDoesNotBecomeDeletion` passed in 17.140 seconds in `/private/tmp/texttext-retained-combined-20261018.log`. The fixture was confirmed uploaded before eviction, the provider reported `notDownloaded`, the production native sync engine sent no deletion, and hydration returned byte-identical complete TextPack data. A second sync also sent no deletion. The remote transport was controlled test data; this does not prove simultaneous iCloud and hosted-transport duplicate delivery or a second Apple device.

The retained disposable cloud folder is `~/Library/Mobile Documents/com~apple~CloudDocs/TextText-provider-verification-8B03D7C1-C79F-45BA-9613-ABC8F2B0142C`. Its private journal and independent original bytes are under `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-provider-state-3165F0F7-30F2-4EF8-9A14-725200F1AF41`. Existing workspace content and provider preferences were untouched.

The test uses Apple's documented [eviction](https://developer.apple.com/documentation/foundation/filemanager/evictubiquitousitem(at:)) and [download](https://developer.apple.com/documentation/foundation/filemanager/startdownloadingubiquitousitem(at:)) APIs. It refuses eviction without confirmed upload and treats an unobservable evicted state as unverified.

## Test isolation correction

The first combined invocation exited 1. This physical test configured a process-wide private device-state directory, contaminating later fixtures that assumed their own default paths. Additional raw recovery and folder-move checks also exposed path-alias bugs being corrected separately. No combined pass is claimed.

Run this suite alone in a fresh process with `TEXTTEXT_ICLOUD_PROVIDER_TEST=isolated`; ordinary runs skip it. Then run the other native suites in another fresh process. The physical test retains its own fixture for inspection. The isolated rerun passes one test with no skips in 13.387 seconds, exit 0: `/private/tmp/texttext-icloud-isolated-20261018.log`. It again observed `notDownloaded`, hydrated exact bytes, and sent zero deletions. Its retained cloud fixture ends in `411B233B-725A-49DE-A3B8-893824C5C2E6`; private state is `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-provider-state-F1C13AAA-A6CD-4BF5-B8A6-B2A367E39CA1`. The separate nonphysical required native gate also passes, exit 0: `/private/tmp/texttext-retained-native-gate-20261018.log`.

## Duplicate delivery and HTTP reconnect

`testRealICloudDuplicateDeliveryAndHTTPReconnectRemainIdle` now uses the actual `HTTPLocalVaultSyncTransport` and native sync engine against the existing disposable loopback TypeScript directory server. The real iCloud root and its device-private state are independent from the loopback peer. The policy evaluator is the existing test harness; the separate current-bundle WK policy fixture also runs below.

The peer uploads a complete TextPack through HTTP while identical bytes arrive in the real cloud directory. A matching later update arrives through both paths. The mirror does not upload the duplicates; subsequent idle passes perform no upload, download, rename or deletion. The fixture then drops all upload replies so URLSession cannot hide the boundary with a transparent retry. The native outbox remains durable, a reconstructed engine reconciles it, the outbox is retired, and a fresh production-transport manifest/download proves one remote identity with the exact latest bytes. Idle after restart remains quiet.

The final phase confirms actual iCloud upload, evicts the fixture until the provider reports `notDownloaded`, syncs without issuing a remote deletion, downloads/hydrates it to byte-identical complete archive data, and syncs again with no upload echo or deletion. The final isolated run passes one test with zero skips in **11.738 seconds**, exit 0: `/private/tmp/texttext-provider-duplicate-http-isolated-final-20261018.log`. Exact before/after hashes of the physical test and HTTP fault fixture match in `/private/tmp/texttext-provider-duplicate-http-isolated-final-20261018.source.json`. Original `mac/Package.resolved` bytes were restored.

The retained cloud folder is `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText-provider-duplicate-2CAF328A-D577-4545-8265-233DCA3AAC98`. Independent originals, the peer, server receipts and private journals are under `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-provider-duplicate-state-5BB8328D-E743-4592-A6AB-8600C5C5449A`. The owned loopback server subprocess was terminated; no persistent job, provider setting or existing document was changed. An earlier successful run and its separate disposable fixtures remain recorded in `/private/tmp/texttext-provider-duplicate-http-isolated-20261018.log`.

This proves real provider upload/eviction/hydration with duplicate filesystem and production-HTTP delivery on one Mac. It does not claim a second Apple device, live hosted-account transport, Dropbox/OneDrive acceptance, or current installed-app delivery.

## Fresh packaged UI check

The complete current folder/recovery UI bundle was also tested with the production WK host before the isolated physical process. Three packaged policy tests, two real offline-window tests, the actual folder Recovery bridge test and the HTTP contract test pass: `/private/tmp/texttext-provider-current-ui-preflight-final-20261018.log` (seven tests, no skips). The first preflight exposed only missing vector fixture files in the newly built temporary bundle; the four absent files were populated from current `sync/fixtures` and the rerun passed. That first invocation is preserved in `/private/tmp/texttext-provider-current-ui-preflight-20261018.log`; it is not counted as a pass.
