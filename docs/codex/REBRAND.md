# Rebrand: Write -> Texttext, write.ramine.net -> texttext.app, strip all "ramine"

Owner decision (2026): the product is now **Texttext**, hosted at **texttext.app**.
Replace the user-visible name "Write" with "Texttext", move the canonical domain to
texttext.app, and remove every trace of "ramine" / "Ramine Darabiha". Work on `main` in
~/dev/write. NO em dashes. Verify with tsc + npm test + npm run build (+ cd mac && swift
build && swift test for Mac changes). Leave changes uncommitted; the integrator commits and
the autobuild daemon ships. Do NOT bump versions or edit mac/Info.plist CFBundleVersion /
src/generated/app-release.ts.

## CHANGE (user-visible only)
1. **Display name "Write" -> "Texttext"** everywhere a HUMAN sees it:
   - Web UI copy, page `<title>` + metadata (generateMetadata, openGraph, manifest name),
     landing/marketing, docs headings, email subjects/bodies, the connect page, privacy /
     terms / security pages, docs/ai.
   - Mac app DISPLAY name: `CFBundleName` / `CFBundleDisplayName` in mac/Info.plist ->
     "Texttext"; the menu-bar title, window titles, About panel, status-item strings, and
     any user-facing "Write" in Swift string literals.
   - The in-app changelog references, README/DESIGN/ARCHITECTURE product-name mentions.
2. **Domain write.ramine.net -> texttext.app** everywhere (code, docs, tests, scripts):
   - src/lib/site-url.ts / tenants.ts / ROOT_DOMAIN default -> texttext.app.
   - WRITE_PRODUCT_ORIGIN documented default + any committed fallback -> https://texttext.app
     (the real value is an env var set at ship time; just fix defaults/docs/comments).
   - connect page, privacy/terms/security, docs/ai, verify-sync-live.ts, verify-workflow-
     live.ts, post-index-route.test.ts fixtures, mac AppHealthReporter.swift + FileProvider
     handoff strings/tests, release/ship.sh + mac/scripts/release.sh + build-app.sh comments.
3. **Strip "ramine" (39 refs)**: replace personal references:
   - ramine@ramine.net -> hello@texttext.app (AUTH_EMAIL_FROM default + all copy/tests).
   - @ramine / @ramine-2 demo usernames + "Ramine Darabiha" display name in demo seed
     (src/lib/demo*.ts) and test fixtures -> neutral ("Texttext", handle "demo"/"texttext").
   - Any ramine.net URL -> texttext.app. Grep `-rniI ramine` and drive it to ZERO in
     src/, mac/, docs/, scripts/, *.md (skip node_modules/.build/.git).

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
  display-name changes. `grep -rniI ramine` over src/ mac/ docs/ scripts/ *.md returns 0
  (outside node_modules/.build/.git).
- Report: files changed, the final `grep ramine` count (must be 0), and a user-facing
  changelog line ("The app is now Texttext, at texttext.app") for the integrator to prepend.

## Owner / infra (NOT Codex - noted so nothing is assumed done)
- Apple Developer console: Services ID net.writeapp.write.web domain + return URL ->
  https://texttext.app/api/auth/callback/apple (else Sign in with Apple breaks on the new
  domain). Google OAuth client: add https://texttext.app/api/auth/callback/google.
- Transactional email: provision a texttext.app mailbox (mxroute-mailbox texttext.app + MX/
  SPF/DKIM DNS on Porkbun) and set AUTH_EMAIL_FROM=hello@texttext.app.
- The Developer ID signing cert is "Ramine Darabiha" (the Apple account holder); removing
  that name needs a separate Apple Developer Organization account. Cannot be done in code.
- Domain wiring is DONE: texttext.app + www added to the Vercel "write" project, DNS pointed
  (apex ALIAS + www CNAME -> cname.vercel-dns.com), textext.app 301-forwards to texttext.app,
  and write.ramine.net stays attached so installed apps keep auto-updating during the move.
