# Agent-authored type across clients, October 9

Installed Mac build 1242, deployed Oracle source `06c3ad60`, signed-in Codex browser, and the physical Windows workspace.

- `texttext do create_item_type` created `Agent custom review check 1242` with a numeric `rating` field and list layout. Its source is `Templates/1318145a-96b6-4af1-87a1-1574cbfe0053.textpack`, template ID `local.1318145a-96b6-4af1-87a1-1574cbfe0053`, version 1. Retrying the same idempotency key returned the same item ID and revision.
- `texttext do create_item` used that type to create `Notes/Agent custom review item 1242-f7750e73.textpack`, item ID `f7750e73-8d2b-4c4e-81e6-f4cf5a7efd18`, with rating 5.
- The signed-in production browser showed the new card without a reload. Opening it showed the saved title, body, and editable Rating stepper at 5. The physical Windows workspace contained the new TextPack.

This verifies creation and propagation. It does not cover custom type update/remix/retire, a live Windows editor view of the item, or a two-account permission round.
