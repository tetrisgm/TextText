# Older native browser-profile recovery, October 17

T07/T17 source slice based on `477b6b11`. Not installed or deployed; no user profile or folder was migrated.

File > Recover older drafts opens a separate, read-only viewer in the historical WKWebView default profile or workspace WebView2 profile. It has no native workspace bridge or account credential. Bundled-page restrictions and CSP block network submission. Known local draft and IndexedDB stores are read without a version upgrade or acknowledgement. Divergent copies are retained separately. Recovery JSON preserves raw local strings, journal operations and supported JSON records; text exports contain title/body only. Original workspace files remain necessary for attachments. Account-specific profiles remain separate.

Unfamiliar database layouts, typed/cyclic/non-JSON records and size limits produce an actionable refusal rather than a lossy export or empty-success claim. Absent databases are not created. Future raw journal strings remain exportable without replay. Cancellation and read errors do not remove originals.

## Verification

- `node src/local-vault/__tests__/legacy-recovery.browser.mjs`, exit 0; `/private/tmp/texttext-t17-legacy-browser-checked.log`. Real Chromium exports five retained records, including divergent copies and operation IDs; unrelated storage is excluded. Read-again preserves bytes and DB versions. Inert text, blocked network, absent DBs, unsupported typed data and unknown future layout checks pass.
- `npm run test:sync:client`, exit 0: 420 tests; `/private/tmp/texttext-t17-legacy-client-checked.log`. TypeScript and the two builder tests pass.
- Full native gate with `TEXTTEXT_LEGACY_VIEWER_BUNDLE=/private/tmp/texttext-t17-legacy-viewer`: exit 0, 41 Mac app tests, 116 kit tests (three existing manual/helper skips), 40 agent tests and Windows core. `/private/tmp/texttext-t17-legacy-native.log`.
- Focused final-bundle WKWebView production-controller test executes one test and passes: `TEXTTEXT_STORE=1 TEXTTEXT_LEGACY_VIEWER_BUNDLE=/private/tmp/texttext-t17-legacy-viewer-final swift test --package-path mac --jobs 2 --filter LocalVaultSessionLifecycleTests.testOlderProfileViewerReadsOriginalWKStorageWithoutReplayingIt`. `/private/tmp/texttext-t17-legacy-wk-final.log`. Both old copies are visible; raw local bytes remain exact, native bridge absent, network blocked.
- Physical PC WPF/Smoke build passes, zero errors (existing NU1510 warning). Interactive production WebView2 viewer reads two old copies, preserves raw local bytes and blocks fetch; native account-review and existing close/activation cases also pass. Initial receipt: `C:\Users\Shokunin\dev\texttext-delivery-65417abd\windows\build\legacy-profile-smoke-20261017`. Final shared-bundle rerun also exits 0: sibling `legacy-profile-smoke-final-20261017`; temporary interactive tasks were unregistered.
- Inspected rendered Mac/Windows screens and shared light/dark screenshots: `/private/tmp/texttext-t17-{mac,windows}-older-drafts*.png`, `/private/tmp/texttext-legacy-recovery-{light,dark}.png`. Text and controls readable.

## Limits and next work

This is explicit local export, not automatic replay/import under a new account. Tests use isolated profiles and native controls, not installed real-account transitions. Historical hosted HTTPS-origin drafts are outside the file-origin/virtual-host viewer and remain in their original browser origin. Mixed-version background writers and missing/corrupt legacy metadata still need compatibility evidence before an installed migration claim. Continue T07 real account switching and T08 ownership; full T17 is not complete. Source rollback leaves original stores unchanged.
