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
systemd resource limits. Both listen only on loopback. The radio service is unchanged. PartyParty moved to a private TLS listener
during the explicitly approved HTTPS cutover.

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

## Public cutover and sign-in repair

The owner approved the PartyParty restart. Its TLS listener moved to loopback
8443; HAProxy now routes the three TextText hostnames to Caddy and passes all
other TLS traffic to PartyParty. Caddy obtained trusted certificates using
TLS-ALPN. The apex and `write.ramine.net` now resolve to Oracle; `www` aliases
the apex. Existing mail records and Chiptunes hosting were preserved.

PartyParty health returned HTTP 200 before and after with the identical TLS
certificate. Radio health remained HTTP 200. Chiptunes' static page remained
byte-identical. No radio restart, tunnel, firewall change, or reboot occurred.

Public native startup exposed an internal-origin redirect: Next's standalone
request URL used `localhost:3400`. Commit `2242c614` resolves the trusted public
origin for redirects, secure session cookies, and generated app links.
`66ba49b5` adds the public-origin redirect to the deployment gate. The deployed
release is `texttext-oracle-20260925T023227Z-2242c614`. Raw loopback and public
`/start?to=home` both redirect to `https://texttext.app/signin`. The temporary
proxy redirect workaround was removed after that verification.

The first real Apple callback linked the installed 0.203 app, but its workspace
page initially returned 500. Next's `/@` rewrite used `https://localhost:3400`
for the plain HTTP standalone listener. `3cbfe686` corrects loopback rewrite
transport; the web-only Oracle release
`texttext-oracle-20260925T034709Z-3cbfe686` passed full unit/database/scale,
type, bootstrap, and authenticated document smoke checks. A real reload of the
installed app rendered the Home workspace. `texttext ls` also found the linked
workspace's documents.

Apple initially rejected the migration's `app.texttext.web` identifier. The
previous production authorization request proved the actual registered ID is
`net.writeapp.write.web`. Oracle now uses that unchanged registration and
Apple presents “Use your Apple Account to sign in to TextText.” No Apple
account or key was replaced. `1784f776` renews signed Apple client credentials
per authentication request for persistent servers.

## Remaining verification

- Native Apple sign-in now completes, but `ASWebAuthenticationSession` displays
  macOS's web-authentication consent dialog. A native Sign in with Apple flow
  needs the Mac App ID entitlement, grouping with the existing web registration,
  and a verified server token exchange. Cancel/retry and fresh-launch behavior
  remain to verify. The agent's Apple Developer portal is signed out.
- Unauthenticated `/@ramine` redirects to `ramine.texttext.app`, which has no
  DNS answer. Public tenant DNS and TLS are not yet cut over.
- Google console confirms the existing callback for `texttext.app`, but neither
  Google nor Vercel will reveal the old client secret. Google remains disabled
  until a replacement secret is stored securely.
- The larger personal-workspace plan remains separate from this migration.

## Verification references

The final release check passed 3,637 unit tests, 98 database tests, four
scale/database tests, TypeScript, and 13 Oracle runtime tests (one optional
local DB test skipped; the real six-step authenticated smoke passed on Oracle).
The restore drill adds four passing guard tests and the full local/remote
recovery checks described above. The final production build and deployment
passed through the manual release entry point. At idle the app service used
about 112 MiB of memory; this is a point-in-time observation, not a load test.
Relevant implementation commits: `21abf1e9`, `1fce29c0`, `a8779061`, `a40e6aa9`,
`49ca114c`, `c723e5f3`, `0ae85e9f`, `1869d244`, `1784f776`, and `5b5c5907`.
