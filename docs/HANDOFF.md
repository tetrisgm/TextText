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
reveal the old one. Apple, GitHub and MXroute email are configured. A completed user OAuth
callback and installed-app sign-in remain to verify.

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
failures. It includes the earlier `d2d7112b` recovery fix. **Next: verify fresh
launch and the Apple button, cancel/retry and completed authentication in the
installed app.** Automated health does not prove those interactions. The owner
requested a fresh-chat handoff because of a reported session memory leak; that
memory issue has not been diagnosed.

Resume the full plan afterward using the final sections of
[the workspace verification receipt](personal-workspace-verification-2026-09-21.md).
The verified [Claude Fable 5.1 review](claude-fable-5-1-adversarial-review-2026-09-21.md)
predates the landed folder/type/destination consolidation; do not reopen those
historical findings without checking the current receipt and code.

The private project changelog remains unwritten: the local CLI reports no linked
workspace until sign-in succeeds. Existing unrelated edits in `attachments.ts`,
`tabs.test.ts`, and `scripts/.probe-editor.ts` remain preserved.

## Historical references

Earlier release notes and checkpoints are preserved in
[September 24 history](HANDOFF-history-2026-09-24.md) and
[September 13 history](HANDOFF-history-2026-09-13.md). Historical deployment,
credential, provider and completion claims need current verification.
