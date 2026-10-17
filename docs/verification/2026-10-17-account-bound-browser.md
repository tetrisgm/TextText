# T07 browser account boundary, first slice

Source based on `25a6bbf3` plus the named browser/server identity changes. Source verification only; neither the installed apps nor Oracle has this new slice yet. T07 remains open until native retained checkpoints, credential replacement and the complete legacy-recovery workflow are covered.

## Invariants and implementation

The authorized page supplies the stable server-resolved user ID. Web transport captures it, includes it in collaboration config, scopes its logical vault root (and therefore local draft/config caches), and sends `X-TextText-Account` on its requests. Fresh owner/scoped authorization compares that precondition with the actual resolved account before reading item bytes or applying changes. The header is not authority and cannot grant access. Discovery at `/api/vault` also returns the nonsecret account ID for subsequent native identity caching. Legacy clients that omit this precondition retain their existing behavior; cross-version enforcement remains an explicit upgrade requirement.

Account-bound collaboration journals use a v2 key containing origin, account, workspace and item; the journal itself includes the account ID. Shared key construction is used by the engine and cached-config fallback. Same-key account mismatch is refused. A different account starts from its authorized baseline and cannot submit the prior account's pending operations. The original account can reopen and submit its own retained work exactly once.

Legacy v1 base and orphan-owner records are inspected without rewriting them. Clean records are left unused while a fresh authorized baseline opens. Pending, retired, recovering, unreadable or divergent unbound records fail closed and remain available through the existing raw-recovery download. They are not silently assigned to the current account. In-app ownership adoption of ambiguous legacy work still needs the upgrade/recovery slice; this source change is not a claim that migration UX is finished.

A changed account prop does not unmount the old mounted draft. It disables its input with `inert`, pauses the application keyboard handler, shows the existing status surface, and leaves late requests tied to the old captured account. A new account cannot acquire the old document-global bridge realm; it must open a new page. Promotion/readiness also compares account identity so an account change cannot promote a local draft into another account's session. Native config currently has no account ID and continues its prior path until the native identity slice is implemented; browser-only key scoping is explicitly insufficient for native retained journals.

## Regression evidence

Before implementation, the two same-store regressions failed: B restored A's pending edit, and an unbound orphan was accepted for the new account. Log `/private/tmp/texttext-t07-account-before.log`. Three initial server/transport assertions also failed before the matching plumbing: `/private/tmp/texttext-t07-account-transport-before.log`.

Passing cases cover A offline → B on the same editable item → A resumes; preservation of unbound pending orphan bytes; a fresh baseline without rewriting a clean legacy record; a forged/mislabelled scoped record; release during asynchronous account-history discovery; captured request headers/config/root; fresh account mismatch rejection before grants/item reads; and stable discovery identity without credential disclosure. New auth tests set the test public origin rather than weakening same-origin protection.

The real Chromium session fixture additionally changes the account while a draft is mounted: value and component lifetime remain, input becomes inert, late requests retain the original account, and same-account rename/workspace ordering still pass. Log `/private/tmp/texttext-t07-account-input-browser.log`. This is not native Safari verification or the full physical two-account campaign.

Final logs:

- `/private/tmp/texttext-t07-account-final-expanded.log`:157 focused tests pass.
- `/private/tmp/texttext-t07-account-client-final4.log`: complete shared client gate and exact-source receipt.
- `/private/tmp/texttext-t07-account-server-final.log`: owner/scoped authorization and discovery route tests.
- `/private/tmp/texttext-t07-account-input-tsc.log`: TypeScript exits0.
- `/private/tmp/texttext-t07-account-input-browser.log`: real browser account-prop/input/session ordering passes.

One intermediate run stalled after an unconditional new async yield changed existing lifecycle timing. It was interrupted by signalling only the owned Vitest process; reduced account cases and the complete suite then passed after the scan was limited to account-bound starts and checked release before continuing. Failure logs are retained. No user journal was rewritten, no production sign-in state was altered for these tests, and no credential or token fingerprint enters JavaScript.

## Next slice

Cache native stable actor identity with existing credentials; bind retained checkpoint/session ownership to it; reject account replacement or late completion without exposing/replaying the prior pending journal. Preserve offline reopening and same-account token renewal. Then finish explicit authorized recovery for ambiguous legacy work and run same-profile/current-source physical account tests before claiming T07 complete or extracting T08 ownership.
