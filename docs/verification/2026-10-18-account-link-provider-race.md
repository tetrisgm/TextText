# Identity linking provider-slot race

The exact `385be4ec` release gate failed its existing concurrent same-user/provider/subject PostgreSQL test with SQLSTATE 23505 on `user_identities_user_provider_idx`: its insert handled only the subject uniqueness conflict. Original evidence remains `/private/tmp/texttext-final-local-candidate-1263-385be4ec.log` lines 894–924. A focused retry passed, demonstrating the race is nondeterministic (`/private/tmp/texttext-account-link-race-red.log`). A new concurrent different-subject/same-provider test reproduced the same constraint error deterministically before the fix (`/private/tmp/texttext-account-link-provider-red.log`, one failed/two passed).

The insert now uses untargeted `ON CONFLICT DO NOTHING`, preserving both existing unique constraints. If insertion loses either conflict, it reads the exact requested subject: only the same recorded user returns `already-yours`; another owner or occupied provider slot returns `taken`. No existing row is moved or replaced. Only the successful insertion writes an audit entry in the same transaction. The OAuth callback retains its original session/intent checks and refuses `taken` with a truthful generic message, avoiding the false claim that a different subject necessarily belongs to another account.

Real local PostgreSQL tests cover 32 simultaneous exact-tuple attempts (one linked, 31 already-yours, one audit), two different subjects racing for one user's provider slot (one refused, unclaimed subject still independently linkable), and two users racing for one subject (one immutable owner/one audit). Refused attempts write no extra audit rows. Fixture users and identities are isolated and removed by the existing test cleanup; no real account or OAuth configuration changes occurred.

Verification on the Mac, loopback database selected by `scripts/with-local-database.mjs`:

- Ten consecutive focused runs: 14 tests each, all passed; `/private/tmp/texttext-account-link-repeat.log`.
- Full database suite: 123 tests/29 files passed, plus all four scale tests; `/private/tmp/texttext-account-link-full-db.log`.
- `tsc --noEmit` passed; `/private/tmp/texttext-account-link-tsc.log`.
- `git diff --check` passed.

This is a source/local-database fix, not production account mutation or a deployed sign-in acceptance claim. The coherent candidate gate must rerun from the committed repair.
