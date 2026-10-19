# Shared saved-rename eligibility

The existing packaged policy host now owns saved-move eligibility: hold, replay the immutable saved request, review, suppress a stopped move, or stage a new move. It allocates no operation IDs and changes no journal or file. Native adapters must revalidate the captured facts, bind receipts to their exact originating request/scope, and archive prior stopped proof before committing a replacement.

Initial staging requires a known baseline, a genuinely changed local name with the server still at that baseline path, a matching ready checkpoint path, verified scope/authority, permission, and known matching file generations. Incoming peer moves and both-diverged names cannot become a fresh outbound request. A pending request replays its original destination and ID even if the live name moved again. Typed terminal rejection requires review; stopped names/generations remain suppressed across peer text changes. A deliberate later local name may become eligible after archival, while a name aligned with the server never creates a no-op move. Changed/deleted generations never bypass review to dispatch an ambiguous historical request.

Strict 23-field observations are echoed with request, page, generation, account, workspace and connection fences. Both native wrappers reject unknown fields/actions and stale observations, and check the page again before returning authority. A missing policy has no native eligibility fallback.

## Verification

- 31 serialized vectors plus two schema/detachment tests and policy-host envelope checks: 43 passing tests. `/private/tmp/texttext-saved-rename-host-first-20261019.log`.
- Fresh packaged Chromium: vectors work offline; replaced pages refuse old saved-rename requests. `/private/tmp/texttext-saved-rename-packaged-first-20261019.log`; bundle `/private/tmp/texttext-saved-rename-policy-ptgmiww9`.
- Swift: two saved-rename wrapper tests plus three actual WK host tests, zero failures/skips. The WK test executes vectors before and after normal fixture-window close. `/private/tmp/texttext-saved-rename-swift-wrapper-first-20261019.log`.
- Portable C#: 176 wrapper assertions, including the same vectors and forged replies. Frozen copied-source runner `/private/tmp/texttext-saved-rename-wrapper-dzf3_esw`; log `/private/tmp/texttext-saved-rename-wrapper-first-20261019.log`. This is not a full integration/PC gate.
- TypeScript noEmit/nonincremental and build source registration tests pass; shell syntax and diff checks pass. `/private/tmp/texttext-saved-rename-host-tsc-final-20261019.log`, `/private/tmp/texttext-saved-rename-build-registration-20261019.log`.
- Exact 15-source manifest: `/private/tmp/texttext-saved-rename-host-source-20261019.json`. Owner Package.resolved restored exactly to SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.

This prepares the shared owner and wrapper API. Native durable replay, explicit terminal recovery actions, current installed candidate and physical six-client acceptance remain separate work. No live profile, account or installed app changed.
