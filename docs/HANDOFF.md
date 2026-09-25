# TextText handoff

## Current: Oracle migration, September 24, 2026

The owner authorized reusing the existing Oracle VM, keeping Chiptunes on
Cloudflare Pages, and discarding TextText's quota-blocked Neon database instead
of paying for recovery. The fresh Oracle app/database passed authenticated
note create/edit/read checks and a real encrypted off-server restore drill.
The obsolete TextText Neon resource is deleted; Chiptunes' separate database
and the shared media Blob store remain intact. The old Vercel `write` project
is paused; backup Blob access was reverified afterward.

Public HTTPS cutover is complete. The owner authorized the PartyParty relay
restart; its TLS listener now sits behind the hostname router. TextText's
three public hosts reach Oracle, while PartyParty and radio health checks and
Chiptunes' static site remained healthy. See the
[migration receipt](oracle-migration-2026-09-24.md).

The live app includes `2242c614`, which fixes self-hosted redirects that sent
the Mac app to `https://localhost:3400`. Both the raw app and public `/start`
redirect now target `https://texttext.app/signin`, without a proxy rewrite.
The Apple Services ID is restored to the registered `net.writeapp.write.web`;
Apple now recognizes TextText and presents its normal sign-in page.

The [Oracle guide](../release/oracle/README.md) is the deployment and recovery
reference. Releases still use the human-invoked `release/ship.sh`; no automatic
build or release jobs were installed. The only new scheduled job is the daily
encrypted database backup.

Google sign-in needs a replacement client secret; Google and Vercel will not
reveal the old one. Apple, GitHub and MXroute email are configured. On September
24, the owner's Apple OAuth callback linked installed TextText 0.203 to the new
workspace. `texttext ls` sees its documents, and a real app reload renders Home.
The initial workspace load showed HTTP 500 because the `/@` rewrite targeted
`https://localhost:3400` while Next listens on plain HTTP. `3cbfe686` fixes
loopback rewrites; the web-only Oracle deployment
`texttext-oracle-20260925T034709Z-3cbfe686` passed its gates and authenticated
smoke. A real app reload then rendered Home.

The owner wants the macOS “TextText wants to use texttext.app to sign in”
dialog gone. `ASWebAuthenticationSession` requires it. On September 25, the
Apple Developer portal was accessible; `app.texttext.mac` was enabled for Sign
in with Apple and grouped with primary `net.writeapp.write`. Its invalid Mac App
Store profile was regenerated and downloaded, and a Developer ID profile for
the correct TextText bundle ID was created. Both local profiles were replaced
under ignored `mac/profiles/`. The App Store profile includes
`com.apple.developer.applesignin`; the Developer ID profile does not. Apple DTS
confirms native Sign in with Apple is unsupported for Developer ID apps. The
owner wants the normal native flow for the Mac App Store edition, so the
temporary standalone device-link change was removed. The working tree now has
the Store entitlement, native authorization controller, and a server endpoint
that exchanges Apple's one-use code and verifies its signed identity token.
The Store and standalone Swift builds, TypeScript check, focused Apple token
tests, and shell syntax check pass. Verify a signed Store build's real Apple
login and account mapping before publishing; it has not been installed or
released. The installed 0.203 Developer ID app still uses the old sheet. The
owner is choosing whether to keep the direct-download edition alongside the
Store edition.

The public `/@ramine` request now redirects instead of returning 500, but its
unauthenticated destination `ramine.texttext.app` does not resolve. Public tenant
DNS/TLS routing remains a separate open cutover issue.

## Active product work

The [personal workspace plan](plans/personal-workspace.md) remains the source
for the desktop Home, news, saved items and documents work. This infrastructure
migration does not declare that larger plan complete. Quantitative performance,
full navigation restoration and remaining end-to-end workflows still need
verification.

Installed native version: **0.203 (1093)**, built from `ce8c3d17` and installed
through `release/ship.sh --local-install` on September 24. Exact-source release
gates passed in 4m 54s, the production web/native builds passed, all 18 app health
checks and installed health passed. Nothing was published to the update channel.

Native fix `a3bccb49` removes hidden startup authentication, presents the real
workspace for explicit sign-in, fences stale retries/callbacks and surfaces
failures. It includes the earlier `d2d7112b` recovery fix. The Apple button,
completed callback and workspace Home are now verified in the installed app;
the consent dialog and cancel/retry experience remain open. The owner
requested a fresh-chat handoff because of a reported session memory leak; that
memory issue has not been diagnosed.

Resume the full plan afterward using the final sections of
[the workspace verification receipt](personal-workspace-verification-2026-09-21.md).
The verified [Claude Fable 5.1 review](claude-fable-5-1-adversarial-review-2026-09-21.md)
predates the landed folder/type/destination consolidation; do not reopen those
historical findings without checking the current receipt and code.

The private project changelog still needs an entry for the verified web fix.
The CLI now sees the linked fresh workspace, but a search for `TextText Changelog`
returned no results; do not create a duplicate of the former
`Shoku's Space/My Notes/TextText Changelog.textpack`. Existing unrelated edits in `attachments.ts`,
`tabs.test.ts`, and `scripts/.probe-editor.ts` remain preserved.

## Historical references

Earlier release notes and checkpoints are preserved in
[September 24 history](HANDOFF-history-2026-09-24.md) and
[September 13 history](HANDOFF-history-2026-09-13.md). Historical deployment,
credential, provider and completion claims need current verification.
