# TextText handoff

## Current: Oracle migration, September 24, 2026

The owner authorized reusing the existing Oracle VM, keeping Chiptunes on
Cloudflare Pages, and discarding TextText's quota-blocked Neon database instead
of paying for recovery. The fresh Oracle app/database passed authenticated
note create/edit/read checks and a real encrypted off-server restore drill.
The obsolete TextText Neon resource is deleted; Chiptunes' separate database
and the shared media Blob store remain intact. The old Vercel `write` project
is paused; backup Blob access was reverified afterward.

Public cutover is pending the explicitly requested approval for one PartyParty
relay restart. Its existing HTTPS listener must move behind the prepared
hostname router. DNS still points to the paused Vercel project, so public TextText remains
unavailable until that switch. Radio and existing services have
not been restarted. See the [migration receipt](oracle-migration-2026-09-24.md)
for the exact completed work, remaining cutover gates, and verification.

The [Oracle guide](../release/oracle/README.md) is the deployment and recovery
reference. Releases still use the human-invoked `release/ship.sh`; no automatic
build or release jobs were installed. The only new scheduled job is the daily
encrypted database backup.

Google sign-in needs a replacement client secret; Google and Vercel will not
reveal the old one. Apple, GitHub and MXroute email are configured. Actual public
OAuth callbacks and installed-app sign-in remain to verify after cutover.

## Active product work

The [personal workspace plan](plans/personal-workspace.md) remains the source
for the desktop Home, news, saved items and documents work. This infrastructure
migration does not declare that larger plan complete. Quantitative performance,
full navigation restoration and remaining end-to-end workflows still need
verification.

Installed native version: **0.202 (1092)**. See [DESIGN.md](../DESIGN.md) and
[the prior visual receipt](artifact-verification-2026-09-19.md). Earlier native
WebKit recovery changes are in source but have not been installed by this
migration. Existing unrelated September edits in `attachments.ts`,
`tabs.test.ts`, and `scripts/.probe-editor.ts` were preserved.

## Historical references

Earlier release notes and checkpoints are preserved in
[September 24 history](HANDOFF-history-2026-09-24.md) and
[September 13 history](HANDOFF-history-2026-09-13.md). Historical deployment,
credential, provider and completion claims need current verification.
