# Live agent image round trip

October 8, 2026. Oracle live `da36425d`; installed Mac 0.204 (1201), source `2f959327`.

Dedicated fixture `Notes/Agent image acceptance 1202.textpack`, identity `299c71f1-4832-4d8d-a67c-4f3db899096b`. Created through the installed CLI, not an existing user note.

- CLI staged `add_item_asset`, public Unsplash mountain image, body placement and Mountain landscape alt text. Proposal `13eb7174-ecac-4a4b-9fc2-c5f4406807ab` was reviewed and approved in actual signed-in Safari. Screen changed to Change applied; technical details remained collapsed.
- The iCloud workspace archive contained a relative body image reference, one image asset, embedded JPEG (247919 bytes) and WebP preview (93038 bytes).
- CLI open routed the file to the installed Mac client. Actual accessibility state contained image Mountain landscape; the native screenshot visibly rendered the mountain landscape inside the note. No unsaved editor draft was modified.
- CLI staged removal of that asset ID with the current hash. Proposal `6b4b6044-aa06-4e6e-bbc9-d8b7936f75ce` was approved in Safari and visibly completed. The already-open Mac note refreshed automatically, removing the image without reopening.
- Independent ZIP inspection after removal showed empty body and asset references, while both image files remained available for recovery. JPEG SHA256 `0dfdab8c495d3474413b471e0850f712f958f786fa7318934852c03bb6594113`; WebP SHA256 `3473c861f0b9b70c29abed9d853b1f85c968f4f829b123a7d4a24c0dda329f37`.

This proves the live CLI proposal, Safari approval, Oracle mutation, local iCloud projection and native rendering/removal path for one body image. It does not attest Windows rendering, another Apple device, all placements live, or a model choosing the tool autonomously. Automated placement and lost-receipt tests are in `src/lib/ai/__tests__/write-proposals.test.ts`.
