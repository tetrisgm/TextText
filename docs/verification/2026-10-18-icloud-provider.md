# Disposable real iCloud provider check

October 18, 2026. Bounded T15 evidence, not complete provider acceptance or an installed app claim.

`LocalVaultPhysicalProviderTests.testRealICloudEvictionDoesNotBecomeDeletion` passed in 17.140 seconds in `/private/tmp/texttext-retained-combined-20261018.log`. The fixture was confirmed uploaded before eviction, the provider reported `notDownloaded`, the production native sync engine sent no deletion, and hydration returned byte-identical complete TextPack data. A second sync also sent no deletion. The remote transport was controlled test data; this does not prove simultaneous iCloud and hosted-transport duplicate delivery or a second Apple device.

The retained disposable cloud folder is `~/Library/Mobile Documents/com~apple~CloudDocs/TextText-provider-verification-8B03D7C1-C79F-45BA-9613-ABC8F2B0142C`. Its private journal and independent original bytes are under `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-provider-state-3165F0F7-30F2-4EF8-9A14-725200F1AF41`. Existing workspace content and provider preferences were untouched.

The test uses Apple's documented [eviction](https://developer.apple.com/documentation/foundation/filemanager/evictubiquitousitem(at:)) and [download](https://developer.apple.com/documentation/foundation/filemanager/startdownloadingubiquitousitem(at:)) APIs. It refuses eviction without confirmed upload and treats an unobservable evicted state as unverified.

## Test isolation correction

The first combined invocation exited 1. This physical test configured a process-wide private device-state directory, contaminating later fixtures that assumed their own default paths. Additional raw recovery and folder-move checks also exposed path-alias bugs being corrected separately. No combined pass is claimed.

Run this suite alone in a fresh process with `TEXTTEXT_ICLOUD_PROVIDER_TEST=isolated`; ordinary runs skip it. Then run the other native suites in another fresh process. The physical test retains its own fixture for inspection. The isolated rerun passes one test with no skips in 13.387 seconds, exit 0: `/private/tmp/texttext-icloud-isolated-20261018.log`. It again observed `notDownloaded`, hydrated exact bytes, and sent zero deletions. Its retained cloud fixture ends in `411B233B-725A-49DE-A3B8-893824C5C2E6`; private state is `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-provider-state-F1C13AAA-A6CD-4BF5-B8A6-B2A367E39CA1`. The separate nonphysical required native gate also passes, exit 0: `/private/tmp/texttext-retained-native-gate-20261018.log`.
