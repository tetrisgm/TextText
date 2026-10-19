# Authored gallery core title fallback

October 18, source-only correction after actual installed1268 acceptance exposed a blank custom gallery with no title/body controls. The owned pack's authored v2 has no `experience` and binds only `content.assets`; changing the built-in gallery-ID check to an experience check would not fix it.

The controlled production-editor regression used that exact validated render/template definition. It failed with zero editable Title controls where one was required: `/private/tmp/texttext-custom-gallery-title-red-second-20261018.log`. The first harness attempt omitted required collection metadata and failed validation before rendering; it is not counted as the product regression.

## Bounded change

An editor-only core Title appears in the existing open Details section only when the item specification declares no `content.title` binding anywhere. It reuses the existing collaborative textarea, Title ref, Yjs callback and initial-focus path. The built-in gallery retains its existing Title control; already-bound templates receive no duplicate. Conditional declared titles remain authored behavior, even when hidden. This does not fix access to conditionally hidden fields or add a body editor.

The blank hint says “Add details to get started.” only when actual Details controls exist. The authored template, rendering, experience, document schema, body, fields and assets are not rewritten. The fallback wrapper shares only the existing collaborative textarea/mirror structural CSS selectors; no colors, fonts, tokens or layout redesign were introduced.

## Verification

- New controlled fixture: exact owned cover-only spec, explicit gallery experience, already-bound Title, conditional hidden Title, and read-only configuration. Eligible controls receive initial focus; trusted `nabc` reaches the same mounted Title. Document/template identity, body, fields and assets remain unchanged. Mirror positioning, readable text and no clipping are asserted. Conditional hidden and read-only variants gain no fallback control.
- Final browser log: `/private/tmp/texttext-custom-gallery-title-final-20261018.log`. Evidence and visually inspected light/dark Details crops: `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-custom-gallery-title-RXX3ba/`.
- Relevant unit tests:42 passed,0 skipped (`/private/tmp/texttext-custom-gallery-relevant-unit-20261018.log`).
- TypeScript passed (`/private/tmp/texttext-custom-gallery-tsc-20261018.log`).
- Existing held-baseline single-editor handoff passed (`/private/tmp/texttext-custom-gallery-title-handoff-regression-20261018.log`).
- Existing document-layout browser checks passed (`/private/tmp/texttext-custom-gallery-document-layout-20261018.log`).
- Official core verification now runs the new fixture. The existing recursive `src` input fingerprints it; normal `scripts/test-sync.sh` delegates to that verifier. Registration tests: 13 passed, 0 skipped (`/private/tmp/texttext-custom-gallery-registration-20261018.log`); shell syntax and diff whitespace checks passed.
- Independent review of the final actual light/dark crops found clean Title and Cover controls without clipping or duplicates.

Early green screenshots exposed missing structural styles outside the document renderer; those intermediate images are not visual acceptance. The final narrow wrapper selector alias and realistic shared-shell fixture corrected that issue before this receipt.

No live content write, installation, deployment or installed acceptance was performed. The normal candidate must still be rebuilt and the original installed workflow repeated.
