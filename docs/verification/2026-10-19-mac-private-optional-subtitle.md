# Private Mac actor optional subtitle

The document schema permits an omitted `content.subtitle`. The private native inspector incorrectly required a string and exact equality with the visible textarea, unlike the existing browser inspector's absence-only comparison. The same mismatch was reached by the actual PC actor after its successful hello. The earlier Mac article reader failure remains preserved separately in [the reader-action receipt](2026-10-19-mac-private-reader-action.md); no corrected Mac runtime success is claimed here.

## Bounded correction

`NativeStressDocumentInspection` compares an absent subtitle with an empty actual textarea, while returning the original full snapshot without adding a subtitle. Present null, numbers, arrays, mismatched textarea values, wrong selected item, missing UI controls, changed title/body, wrong template and future schema refuse. Native validation permits only absent or string subtitle, rejects null/nonstring and nonnumeric/future schema, and keeps the 256 KiB evidence bound. The existing validated snapshot API remains the source of the document.

All multi-field input comparisons now use an explicit field-value helper: only an absent subtitle reads as empty; absent body and present nonstrings throw. It never rewrites the snapshot or defaults other fields. The article schema audit found subtitle is the only optional content property; the remaining content properties are populated by the production schema's defaults. No renderer, fixture, product or persistence change was made. All code is conditional on `TEXTTEXT_STRESS_ACTOR`.

## Focused evidence

The real WK tests exercise omitted, empty and existing subtitle snapshots and preserve their exact complete dictionaries. The omitted case also proves the original strict comparison returns false. Ten invalid UI/identity/schema cases refuse. Native tests cover null/nonstring, missing required title/body, boolean/fractional/future schema and oversized input; field input tests confirm absence-only semantics without mutation.

Final gate: **20 passed, zero failed, zero skipped**: four new inspection tests plus the prior sixteen private actor/reader tests. Log `/private/tmp/texttext-mac-private-subtitle-inspection-focused-20261019.log`, SHA256 `4044abb1e7c30aefc34c0ae27a279882a59b234db5d95deccb66ebdb0bc36654`. All children exited. Owner Package.resolved was restored exactly in finally, SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`. This is controlled source/WK evidence, not a successful native bootstrap, normal close-probe or six-client result.

## Build scope and retained earlier gates

The completed earlier frozen `df4363d09376b835c224ef364cbb87a3f83d31c5` prerequisite archive passed its official 22 release gates, sixteen actor tests, capability and attestation checks. Evidence stays under `/private/tmp/texttext-private-mac-actor-df4363d0-prerequisites-20261019/`. It proves only that older source; no df standard actor build was launched and those receipts cannot qualify this correction.

The unchanged standard private build wrapper supports omitting optional release attestation: `build-app.sh` only copies `TEXTTEXT_BUILD_ATTESTATION` when provided. Native runtime identity independently verifies the sealed source receipt, executable/UI hashes and actual account scope; it does not read a release-health attestation. The next reviewed private build will use the ordinary wrapper's full sync/build/sign/seal steps with **no inherited release/capability/attestation environment**, a fresh exact-source archive and actual private sidecar. It will make no normal-release health claim. A new committed source, actual artifact build and runtime authorization remain required; the installed normal a041 product is unchanged.
