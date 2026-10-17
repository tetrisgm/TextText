# Mac adoption and native process recovery, October 17

T17 prerequisite for T07, source only. No user state adopted and no installed artifact changed. Implements the [adoption transaction](account-adoption-transaction.md) with explicit review and retired writers as caller preconditions.

The Mac helper preserves exact original metadata, pending operation IDs, checkpoint content, projected packs and assets. It binds a resumable intent to the canonical root and verified account, validates originals/replacements before applying, checks each live target again, and retains backups and a completion receipt. Cached permissions become denied until freshly authorized. Future, malformed, foreign, unsafe, corrupt and divergent records remain protected. Deterministic encoding permits a different process to validate frozen replacement hashes.

Tests exposed two defects: temporary-directory aliases caused false path rejection, and NSNumber boolean coercion accepted invalid journal integers. Canonical child resolution and explicit numeric validation fix these cases. Future capability-cache versions are also refused unchanged.

## Verification

- `bash scripts/test-sync.sh --native-only` exits 0 on the complete source: `/private/tmp/texttext-t17-adoption-final-native.log`. 37 Mac app tests, 114 File Provider kit tests, 40 agent tests and the full Windows core suite pass. Two kit skips are the separately run real disk-full test and the child-only test method, which the parent invokes in a real separate process.
- Mac adoption covers six interruption boundaries, exact originals and pending replay once, capability denial, foreign/future/corrupt/unsafe state and between-step divergence. A separate xctest process resumes the recorded transaction and preserves the original operation and pack.
- Windows separate-process adoption also passes the Mac core runner and physical PC core runner: `C:\Users\Shokunin\dev\texttext-t17-adoption-process.log`.
- Before-fix receipts: `/private/tmp/texttext-t17-mac-adoption-tests.log`, `/private/tmp/texttext-t17-mac-journal-bool-before.log`. Corrected focused results: `/private/tmp/texttext-t17-mac-adoption-process.log`.

## Remaining and recovery

Real disk-full adoption now passes on both native platforms; see the [storage and writer-fence receipt](2026-10-17-adoption-storage-fences.md). Remaining: explicit consent/current authorization UI, browser-profile recovery, cross-process writer exclusion and background callers remain. Existing unbound work stays blocked until review. Retained originals support forward recovery; an older binary must not write adopted state. This source unit does not complete T07 or T17 and must not be installed before the recovery flow is ready.
