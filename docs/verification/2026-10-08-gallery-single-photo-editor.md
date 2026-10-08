# Single-photo Gallery metadata

The shared document editor now shows asset source/tags for a single-image TextPack, just as the Gallery inspector does. Missing photo values still display legacy collection defaults; editing writes to the photo's stable asset identity. Collection metadata remains available for multi-image packs.

Rebuilt offline browser acceptance passed inspector-to-editor source/tag reads, per-photo tag removal/addition, source editing, saved TextPack checks, and inspector reopening. Collection source and tags remained unchanged. Existing multi-image metadata, Gallery viewing and the full offline fixture passed (`/tmp/texttext-gallery-single-browser.log`). TypeScript passed (`/tmp/texttext-gallery-single-types.log`). No client installation or Oracle deployment is implied by this source acceptance.
