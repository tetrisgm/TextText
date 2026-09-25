# Oracle migration, September 24, 2026

## Decision and data reset

The owner authorized hosting TextText on the existing Oracle ARM64 VM and
keeping Chiptunes on Cloudflare Pages. Neon refused even a database export
because its quota was exhausted. The owner declined a paid recovery and
explicitly authorized discarding the old server database. No paid upgrade was
made. The Oracle database starts empty; this is not a data migration.

TextText's `neon-cobalt-chair` resource was deleted on September 25 UTC. Its
Vercel storage lookup returned 404 afterward. The separate
`chiptunes-agent-sessions` database and `write-media` Blob store were verified
present afterward. The shared Neon integration was not removed. The obsolete Vercel `write` project
was paused (API returned 200; subsequent project read confirmed `paused: true`).
A fresh encrypted backup upload still passed after the pause, verifying that
Blob access remains independent of the paused compute project.

## Running on Oracle

The app and PostgreSQL use the existing `ubuntu` account and fleet SSH key.
No accounts, SSH identities, tunnels, firewall changes, or machine reboot were
introduced. PostgreSQL 16 and the standalone Linux ARM64 app run under separate
systemd resource limits. Both listen only on loopback. Existing radio and
PartyParty services are still unchanged at this checkpoint.

The human-invoked [release entry point](../release/ship.sh) now deploys to
Oracle. `--web-only` runs the local unit/database/type checks, builds on the Mac,
packages Linux dependencies, transfers a verified archive, migrates PostgreSQL,
and checks authenticated document operations. The old application release is
retained for rollback. Schema changes are not automatically reversed.

The first launch caught a `current` symlink entrypoint bug; `c723e5f3` fixes
all Oracle command entrypoints and adds invocation regressions. The successful
deployment passed authenticated session, workspace read, note creation/read,
note edit/read, canonical storage/audit, and scratch cleanup. Native Linux
Sharp image conversion also passed.

## Backup verification

The app and PostgreSQL services are enabled for boot. A daily backup timer is
enabled at 04:15 UTC with up to ten minutes of jitter. It only backs up data;
it never builds, deploys, reinstalls, or restarts the app.

Local dumps are private. Off-server backups are authenticated AES-256-GCM
ciphertext in the existing Blob store. Default retention is seven days, at most
500 MiB remotely and 5 GiB locally; each remote upload is capped at 100 MiB.
Blob storage and operations remain metered. The existing Oracle instance's
actual billing classification was not verified, so this is not a claim of zero
hosting cost.

The first real recovery drill downloaded the encrypted backup, decrypted it
using the independent login-Keychain recovery key, restored into a newly named
scratch database, and verified all 45 public tables, protection triggers,
canonical schema validation, and identical row counts. There were zero
documents, consistent with the authorized fresh start. Scratch data was removed.
A separate local drill restored 6,120 canonical documents successfully.

Manual recovery instructions and the executable drill are in
[the Oracle runtime guide](../release/oracle/README.md#backups-and-recovery).
No secret is in the repository or this receipt.

## Remaining cutover gates

- The new app is verified privately as
  `texttext-oracle-20260925T021106Z-5b5c5907`; DNS still points to the paused
  Vercel project. Public TextText is therefore unavailable until cutover.
- Sharing public HTTPS requires moving the existing PartyParty listener to
  loopback 8443 and restarting that service once. A narrow approval request is
  pending, as required by the owner's infrastructure contract. HAProxy and
  Caddy configurations are installed and validated but not running.
- After that approval: switch DNS, obtain and verify HTTPS certificates,
  verify public assets and installed-app sign-in. Keep the old Vercel
  `write` project paused and preserve the Blob store.
- Apple, GitHub, and MXroute email are configured. GitHub credentials and SMTP
  authentication were verified without signing in a user or sending mail.
  Apple key material matches the existing documented key; its real callback
  remains untested. `1784f776` renews Apple credentials per auth request for
  persistent servers.
- Google console confirms the existing callback for `texttext.app`, but neither
  Google nor Vercel will reveal the old client secret. Google remains disabled
  until a replacement secret is created and stored securely. Other providers
  are available.
- The installed Mac application remains 0.202 (1092); its native updates and
  the larger personal-workspace plan are not declared complete by this migration.

## Verification references

The final release check passed 3,617 unit tests, 98 database tests, four
scale/database tests, TypeScript, and 13 Oracle runtime tests (one optional
local DB test skipped; the real six-step authenticated smoke passed on Oracle).
The restore drill adds four passing guard tests and the full local/remote
recovery checks described above. The final production build and deployment
passed through the manual release entry point. At idle the app service used
about 112 MiB of memory; this is a point-in-time observation, not a load test.
Relevant implementation commits: `21abf1e9`, `1fce29c0`, `a8779061`, `a40e6aa9`,
`49ca114c`, `c723e5f3`, `0ae85e9f`, `1869d244`, `1784f776`, and `5b5c5907`.
