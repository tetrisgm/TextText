# Quick Look delivery

Source `20d7bb91`, signed local Store-shaped Mac **0.204 build 1226** installed
at `/Applications/TextText.app`. No public release or Oracle deployment.

## Root cause

The data-based preview provider implemented the callback but did not declare
`QLPreviewingController` conformance. The SDK's `QLPreviewProvider.h` explicitly
requires this on the subclass. Finder showed only a generic TextPack icon.
The provider now declares the protocol; a native regression checks both runtime
conformance and the system callback selector.

## Acceptance

- Nine `TextPackPreviewTests` pass, including protocol dispatch, bounded input,
  archive validation and HTML escaping. `/tmp/texttext-quicklook-protocol-tests.log`.
- Required exact-source sync gate passed: 848 shared tests and native suites.
  Build/signature verification passed, including all three extensions.
  `/tmp/texttext-mac1226-build.log`.
- Established installer verified and launched one canonical copy. Previous
  app remains recoverable. `/tmp/texttext-mac1226-install.log`. The sandbox-private
  runtime-health report was not asserted; actual startup was inspected instead.
- Actual Finder Space preview of the existing iCloud
  `Notes/Parent menu live verification 1218.textpack` now renders its saved title
  and body, including `Cache1221p7m4 saved-body verification.` Registration,
  extension election and content were not changed to make the preview pass.
- The reopened app shows `ramine@ramine.net`, Signed in, and the existing
  `Safari share verification 1224` bookmark with its original URL intact.

File Provider interaction, Share file attachments and actual Share append
interaction remain separate acceptance work. This change does not affect the
Windows recovery client; its installed source remains `ab8d2968`.
