# Portable catalog regression host correction

The unified release stopped in the Mac-hosted Windows Core fixture before installation. RetainedFileReplacement.Fingerprint intentionally returns null outside Windows; InspectGenerationInventory therefore cannot certify the physical identity of a held local file. The fixture incorrectly expected the Windows success path on that portable host.

Production behavior is unchanged. The non-Windows fixture now asserts the specific unavailable-identity refusal, byte-exact preservation of both local files and the durable state/outbox, zero upload/download dispatch, and absence of a stale scoped warning over the fatal error. The Windows fixture retains all 17 success/adversarial assertions. The focused entry point also canonicalizes Mac /var temporary paths to /private/var, matching other native fixtures and preserving link rejection.

Checks: Mac focused 3/3 PASS in /private/tmp/texttext-catalog-portable.sHKqVg/focused.log; PC elevated focused 17/17 PASS in %TEMP%/texttext-catalog-portable-pc.log; diff check PASS. Only tests changed. Prior full Windows Core/Bridge/WPF results remain in the [quarantine receipt](2026-10-23-windows-catalog-quarantine.md). The failed release was not restarted here and installed acceptance remains pending. Owner Mac checkout and Package.resolved were untouched.
