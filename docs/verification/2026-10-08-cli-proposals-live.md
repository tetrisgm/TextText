# CLI proposal and custom field acceptance, 2026-10-08

Oracle source `f3167c4b`, release `texttext-oracle-20261008T090012Z-f3167c4b`. Used the installed CLI with the existing account. Only dedicated verification content from the 1190 acceptance was changed.

## Verified

- Saved version 3 of `local.3c1b183a-d37a-46d7-8807-58e8e80fbf5d`, adding declared text field `reviewStatus`. Source identity `c78fe5e2-ac5d-4638-813c-e6f8b59231c2`.
- Created `5503789d-c8d6-4777-8414-e4360494ba62` at `Template verification 1190/Custom field verification 1191-5503789d.textpack`.
- Updated only `reviewStatus` from `Pending` to `Verified 1191`. Identical request/key replay returned the identical full receipt. Readback preserved the title, body marker `Custom field verification 1191.`, and pinned template version 3. Revision `2f30d516f1843251325ad24aa9b758c1bd879ea5ceba7c18c14bf212a5972962`.
- Installed `texttext propose retire_document_template` returned pending proposal `ece1a44d-14b8-4955-b35f-5df1a4d5dac0` and its owner review URL. No direct execution bypass was used.
- Parent verified the source/template/hash in actual Safari and explicitly clicked Approve. The completed result identified retirement record `d630daf1-741b-4a69-83a5-589d637c6989`, revision `a33273f0aabd896971d5842c3e474861d41783007afe3de3f4123e7fd8a05e9c`.
- Subsequent template listing omitted the retired identity. Explicit creation using its pinned version failed with the retired-template error.
- The version-3 item remained byte-for-byte equal in canonical read response to its pre-retirement response. Existing version-2 item `dd009497-291e-40e5-8b81-3b8927fd8bc0` retained its embedded version and original starter body.
- The dedicated verification folder remains configured with built-in `texttext.note`, version 1. No existing user folder default was changed.

Transient CLI receipts: `/tmp/texttext1191-accept/`. These contain verification content and IDs, no credentials. Source-level lost-response, authorization and persistence regressions are recorded in commit `bea42962`; this live check does not claim a repeated browser approval test.
