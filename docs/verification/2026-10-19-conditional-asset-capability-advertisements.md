# Conditional asset-proof capability advertisements

Source-only integration of four reviewed hello metadata changes. Browser/file adapters advertise `binaryAssetObservation: 1` only after the existing sealed identity branch succeeds. Private native actors advertise it only after observed identity succeeds; legacy/unsealed attestations remain unadvertised. Producer validation, commands and document mutations are unchanged.

## Checks

- Main focused metadata/refusal tests: 9 passed, no skips.
- Main combined capability, file-adapter and browser-adapter suites: 45 passed, no skips. Log: `/private/tmp/texttext-conditional-caps-main-js-final-20261019.log`.
- Four controlled JavaScript return-builder cases test conditional metadata; one static check bounds private native branches. Four actual disposable file actors test legacy hello, foreign platform, misplaced proof and forged identity refusal, preserving fixture bytes.
- These checks do not launch a browser or native actor and do not prove genuine sealed-runtime positives. Main registered flagged Mac native gate passed all 11 required methods with no skips, including actual controlled WK validation. Log: `/private/tmp/texttext-conditional-caps-native-main-20261019/native.log`. All six owned hashes matched before/after; owner Package.resolved restored to `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`. Actual Windows helper 68 and controlled WebView 8 checks passed with no skips; Smoke and private actor projects compiled successfully, including the exact conditional hello source. Evidence: `/private/tmp/texttext-pc-asset-capability-controlled-7ef-20261019/result.json` (SHA256 `cdfd293e87efb2dea3b4e390735e0efbbffe271bae3b15c4256c4bef2fe965f4`). This used pristine 7ef source plus two explicit reviewed overlays; all 3332 tracked source hashes matched before/after. No actual actor runtime or seal was produced. Fresh sealed all-six read-only proof is required before any asset-proof mutation campaign.

The reviewed activation-v2 prepared source was copied only after all four expected main hashes matched. StateStore test isolation is tracked in a separate change and gate; production StateStore is unchanged. No activation, campaign, normal UI, release or installation was performed.
