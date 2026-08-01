# Rebrand to TextText and TextText.app

> **ARCHIVED / DELIVERED (historical record).** The rebrand to TextText at
> TextText.app is complete. Nothing below is current project status.

Owner decision (2026): the product is now **TextText**, hosted at **TextText.app**.
Use the user-visible name "TextText", use TextText.app as the canonical domain,
and remove every trace of the former personal branding. Work on `main` in
~/dev/TextText. NO em dashes. Verify with tsc + npm test + npm run build (+ cd mac && swift
build && swift test for Mac changes). Leave changes uncommitted; the integrator commits and
the autobuild daemon ships. Do NOT bump versions or edit mac/Info.plist CFBundleVersion /
src/generated/app-release.ts.

## CHANGE (user-visible only)
1. **Display name "TextText"** everywhere a HUMAN sees it:
   - Web UI copy, page `<title>` + metadata (generateMetadata, openGraph, manifest name),
     landing/marketing, docs headings, email subjects/bodies, the connect page, privacy /
     terms / security pages, docs/ai.
   - Mac app DISPLAY name: `CFBundleName` / `CFBundleDisplayName` in mac/Info.plist ->
     "TextText"; the menu-bar title, window titles, About panel, status-item strings, and
     any user-facing product name in Swift string literals.
   - The in-app changelog references, README/DESIGN/ARCHITECTURE product-name mentions.
2. **Domain TextText.app** everywhere (code, docs, tests, scripts):
   - src/lib/site-url.ts / tenants.ts / ROOT_DOMAIN default -> TextText.app.
   - TEXTTEXT_PRODUCT_ORIGIN documented default + any committed fallback -> https://TextText.app
     (the real value is an env var set at ship time; just fix defaults/docs/comments).
   - connect page, privacy/terms/security, docs/ai, verify-sync-live.ts, verify-workflow-
     live.ts, post-index-route.test.ts fixtures, mac AppHealthReporter.swift + FileProvider
     handoff strings/tests, release/ship.sh + mac/scripts/release.sh + build-app.sh comments.
3. **Strip former personal branding**:
   - Personal sender addresses become noreply@TextText.app. The AUTH_EMAIL_FROM default
     is "TextText <noreply@TextText.app>".
   - Personal demo usernames and names in demo seed and test fixtures become neutral
     values such as "TextText" and the handles "demo" or "texttext".
   - Personal-site URLs become TextText.app. Drive the former owner-name search to zero in
     src/, mac/, docs/, scripts/, and root markdown files.

## DO NOT CHANGE (frozen technical anchors - users never see these; changing them breaks
   auto-update, sign-in, or the build)
- Bundle id `app.texttext.mac` (Sparkle, login items, TCC anchor to it) and the other
  net.texttext.* Apple identifiers.
- The Sparkle feed path `appcast.xml`, bundle identifiers, executable name, and
  legacy `/download/TextText.zip` alias. New releases install as
  `/Applications/TextText.app`, publish immutable `TextText-<version>.zip`
  artifacts, and expose `/download/TextText.zip`. The ship flow retains the
  legacy alias and migrates `/Applications/TextText.app` so installed 0.10x apps
  keep updating.
- The repo directory ~/dev/TextText, git remote, and all CODE SYMBOLS: class/type/file names
  (TextTextFileProviderExtension, TextTextAppWindow, TextTextFilename, etc.), TEXTTEXT_* env var NAMES,
  css class prefixes. Rename only human-readable strings, never identifiers.
- Apple Team ID / signing identity (owner handles separately).

## Verify + report
- Web green (tsc + test + build); Mac green (swift build + test) for the Info.plist/Swift
  display-name changes. The former owner-name search over src/, mac/, docs/, scripts/,
  and root markdown files returns 0 outside node_modules, .build, and .git.
- Report: files changed, the final former owner-name count (must be 0), and a user-facing
  changelog line ("The app is now TextText, at TextText.app") for the integrator to prepend.

## Owner / infra (NOT Codex - noted so nothing is assumed done)
- Apple Developer console: Services ID app.texttext.web domain + return URL ->
  https://TextText.app/api/auth/callback/apple (else Sign in with Apple breaks on the new
  domain). Google OAuth client: add https://TextText.app/api/auth/callback/google.
- Transactional email: provision a TextText.app mailbox (mxroute-mailbox TextText.app + MX/
  SPF/DKIM DNS on Porkbun) and set AUTH_EMAIL_FROM="TextText <noreply@TextText.app>".
- Removing the personal name from the Developer ID signing certificate needs a separate
  Apple Developer Organization account. It cannot be done in code.
- Domain wiring is DONE: TextText.app + www added to the Vercel "texttext" project, DNS pointed
  (apex ALIAS + www CNAME -> cname.vercel-dns.com), the common typo forwards to TextText.app,
  and TextText.app stays attached so installed apps keep auto-updating during the move.
