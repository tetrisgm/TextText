# CLI canonical vault inventory and portable creation

## Cause and change

The installed 4eca CLI selected a SQL-era folder named `Notes` whose stored path was `notes`. Its filesystem `create_item` command consequently introduced a lowercase alias beside the existing `Notes`. The SQL-era folder manifest also omitted the new filesystem item, so a fresh CLI could not resolve its returned physical path. UUID reads remained available. The owner subsequently approved recovery of that one new lowercase tree through the supported proposal UI; this change does not perform that recovery.

The CLI now reads the existing canonical vault directory and full filesystem manifest, with captured and reread account/workspace checks. It requires the authoritative owner folder catalog, preserves physical paths and complete item IDs, rejects ambiguous portable paths, and never falls back to the SQL inventory. Selected local bindings and credentials are revalidated around awaited inventory and document reads, and before/after create attempts including the bounded lost-response retry. A supplied parent path cannot fall back to a different folder's matching basename. Creation uses the canonical folder spelling; a missing response path requires a fresh canonical inventory match rather than an invented filename.

The server independently checks existing parent spellings under its vault lock before creation helpers can create directories, and repeats the check after template-selected paths. Conflicting case/NFC spellings refuse without choosing or renaming existing folders. Completed operation receipts retain their existing replay behavior.

## Evidence

- Actual read-only canonical wire probe: `/private/tmp/texttext-cli-canonical-readonly-20261019.json`. Same hashed principal/workspace before and after; HTTP 200; 194 items and 17 authoritative folders; `Notes` present, lowercase `notes` absent; exact recovered target UUID and physical path present. No owner document mutation or credentials were recorded.
- Server RED: `/private/tmp/texttext-portable-create-path-red-20261019.log`, three failures before the guard. Final focused server log: `/private/tmp/texttext-portable-create-path-final-20261019.log`, six passes including the existing whole-folder propagation regression and completed-receipt replay. The separate NFC RED is `/private/tmp/texttext-portable-create-nfc-red-20261019.log`; it reproduced normalized-equivalent parent acceptance before the raw spelling fix.
- Swift: `/private/tmp/texttext-canonical-cli-final-20261019.log`, 41 passes, no skips: canonical transport 3, remote CLI 30, and selected-local authority 8. Includes a 151-item inventory, fresh-store create/resolve roundtrip, legacy virtual-name collision, changed account/credential refusal (including successful/lost create response), default lowercase folder spelling, normalized folder lookup preserving actual bytes, and foreign-parent refusal.
- Nonincremental TypeScript check: `/private/tmp/texttext-cli-canonical-tsc-20261019.log`, exit 0. `git diff --check` also passed.
- Owner `mac/Package.resolved` was saved and restored as exact bytes; SHA-256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.

These are source/isolated fixture checks plus a read-only deployed inventory observation. No new candidate was installed or deployed, and the installed CLI has not been relabeled as fixed. Native mirror convergence and the broader six-client acceptance remain separate work.

## Fresh rebuilt CLI, read-only follow-up

Three actual fresh processes of the linked debug CLI from reviewed source
`9e7daa62` listed194 unique physical paths, listed115 under canonical `Notes`,
and resolved/read the exact recovered fixture path. All exited0. Binary SHA-256:
`309a608cd9ea6e6705d742f8d1a37e81feb0440f21428bdf25b5cbc0ed70b00f`.
Receipt: `/private/tmp/texttext-cli-canonical-fresh-process-20261019/receipt.json`,
SHA-256 `b3d7b43db9a28f9487a57693e7e71428afd7ddaac75a29d6d501f0ab38703c53`.
The installed shim was untouched. These checks preceded the later owned-fixture
Trash tests; counts and hashes are point-in-time evidence. No create/write,
installation, full physical campaign or performance distribution is claimed.
