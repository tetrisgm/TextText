# Rebrand to Texttext and texttext.app

Owner decision (2026): the product is now **Texttext**, hosted at **texttext.app**.
Use the user-visible name "Texttext", use texttext.app as the canonical domain,
and remove every trace of the former personal branding. Work on `main` in
~/dev/write. NO em dashes. Verify with tsc + npm test + npm run build (+ cd mac && swift
build && swift test for Mac changes). Leave changes uncommitted; the integrator commits and
the autobuild daemon ships. Do NOT bump versions or edit mac/Info.plist CFBundleVersion /
src/generated/app-release.ts.

## CHANGE (user-visible only)
1. **Display name "Texttext"** everywhere a HUMAN sees it:
   - Web UI copy, page `<title>` + metadata (generateMetadata, openGraph, manifest name),
     landing/marketing, docs headings, email subjects/bodies, the connect page, privacy /
     terms / security pages, docs/ai.
   - Mac app DISPLAY name: `CFBundleName` / `CFBundleDisplayName` in mac/Info.plist ->
     "Texttext"; the menu-bar title, window titles, About panel, status-item strings, and
     any user-facing product name in Swift string literals.
   - The in-app changelog references, README/DESIGN/ARCHITECTURE product-name mentions.
2. **Domain texttext.app** everywhere (code, docs, tests, scripts):
   - src/lib/site-url.ts / tenants.ts / ROOT_DOMAIN default -> texttext.app.
   - WRITE_PRODUCT_ORIGIN documented default + any committed fallback -> https://texttext.app
     (the real value is an env var set at ship time; just fix defaults/docs/comments).
   - connect page, privacy/terms/security, docs/ai, verify-sync-live.ts, verify-workflow-
     live.ts, post-index-route.test.ts fixtures, mac AppHealthReporter.swift + FileProvider
     handoff strings/tests, release/ship.sh + mac/scripts/release.sh + build-app.sh comments.
3. **Strip former personal branding**:
   - Personal sender addresses become noreply@texttext.app. The AUTH_EMAIL_FROM default
     is "Texttext <noreply@texttext.app>".
   - Personal demo usernames and names in demo seed and test fixtures become neutral
     values such as "Texttext" and the handles "demo" or "texttext".
   - Personal-site URLs become texttext.app. Drive the former owner-name search to zero in
     src/, mac/, docs/, scripts/, and root markdown files.

## DO NOT CHANGE (frozen technical anchors - users never see these; changing them breaks
   auto-update, sign-in, or the build)
- Bundle id `net.writeapp.write.mac` (Sparkle, login items, TCC anchor to it) and the other
  net.writeapp.* Apple identifiers.
- The installed app path /Applications/Write.app and the Sparkle feed FILENAMES
  (download/Write.zip, appcast.xml) - keep them "Write*" so installed 0.10x apps still
  auto-update. (Display name changes; the bundle on disk stays Write.app.)
- The repo directory ~/dev/write, git remote, and all CODE SYMBOLS: class/type/file names
  (WriteFileProviderExtension, WriteAppWindow, WriteFilename, etc.), WRITE_* env var NAMES,
  css class prefixes. Rename only human-readable strings, never identifiers.
- Apple Team ID / signing identity (owner handles separately).

## Verify + report
- Web green (tsc + test + build); Mac green (swift build + test) for the Info.plist/Swift
  display-name changes. The former owner-name search over src/, mac/, docs/, scripts/,
  and root markdown files returns 0 outside node_modules, .build, and .git.
- Report: files changed, the final former owner-name count (must be 0), and a user-facing
  changelog line ("The app is now Texttext, at texttext.app") for the integrator to prepend.

## Owner / infra (NOT Codex - noted so nothing is assumed done)
- Apple Developer console: Services ID net.writeapp.write.web domain + return URL ->
  https://texttext.app/api/auth/callback/apple (else Sign in with Apple breaks on the new
  domain). Google OAuth client: add https://texttext.app/api/auth/callback/google.
- Transactional email: provision a texttext.app mailbox (mxroute-mailbox texttext.app + MX/
  SPF/DKIM DNS on Porkbun) and set AUTH_EMAIL_FROM="Texttext <noreply@texttext.app>".
- Removing the personal name from the Developer ID signing certificate needs a separate
  Apple Developer Organization account. It cannot be done in code.
- Domain wiring is DONE: texttext.app + www added to the Vercel "write" project, DNS pointed
  (apex ALIAS + www CNAME -> cname.vercel-dns.com), the common typo forwards to texttext.app,
  and texttext.app stays attached so installed apps keep auto-updating during the move.
