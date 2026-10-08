# Reference selection concurrency

The shared parent/document picker awaited identity resolution, then appended to
the selection captured before the lookup. A concurrent document update could
therefore resurrect removed parents or discard newly added parents. A source
change during resolution could also deliver a stale result into another context.

The completion handler now checks the current reference source, field identity,
cardinality and editability. Multiple references append to the latest selection;
single references refuse replacement if the selection changed during resolution.

The actual browser regression delays resolution and changes the rendered value
before releasing it. It verifies concurrent removal/addition preservation,
obsolete-source refusal, and single-selection conflict refusal. Existing picker
navigation, removal and Escape behavior still pass. The complete note-template
browser command passed, including open-file relocation and template round trips.
Ten relevant unit tests and TypeScript passed on the Mac.

Logs: `/tmp/texttext-parent-concurrent-browser.log`,
`/tmp/texttext-parent-concurrent-full-browser.log`,
`/tmp/texttext-parent-concurrent-unit.log`,
`/tmp/texttext-parent-concurrent-types.log`.

Installed in [Mac 1217](2026-10-08-mac-1217.md), deployed on Oracle and packaged
for Windows. [Delivery receipt](2026-10-08-reference-picker-delivery.md).
Windows installation remains.
This is one picker race regression, not certification of all concurrent mutations.
