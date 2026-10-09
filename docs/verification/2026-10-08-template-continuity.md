# Template changes during shared editing

The store regression reproduced a reset from epoch 1 to 2 when a verified file
edit added `template.json`, even though the same document remained open and a
human had an unsent text insertion. Baseline receipt:
`/tmp/texttext-template-continuity-before.log`.

The projection boundary now accepts added, changed or removed template sidecars
without rebuilding the Yjs baseline. Changed definitions and authoring sources
must pass their schemas and size bounds. The resulting document must still
resolve to an available template. Unchanged legacy provenance remains opaque;
unsupported changed metadata keeps its prior fence.

Regression coverage includes definition/source addition, change and removal;
switching to an embedded custom template while old text is pending; exact
sidecar preservation after that text commits; and malformed changed sidecars.
Identity, causal base and permission checks are unchanged.

Final core gate passed 859 tests, TypeScript and all three browser continuity
modes with an exact-source receipt:
`/tmp/texttext-template-continuity-core-final.log`. The first core run passed its
tests but correctly refused a receipt after source was refined during the run;
only the final run is the attestation.

This is a server projection change. Actual Mac/Windows editor continuity through
a live template change and Oracle deployment remain outstanding. It does not
repair the earlier retired Windows journal or prove six-client acceptance.
