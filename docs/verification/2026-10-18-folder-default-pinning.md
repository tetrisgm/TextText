# Owned folder default and immutable pinning

Actual authenticated CLI tests against the live F994 server used only owned folder `Template acceptance 20261018 fa692167` in workspace `be28ae03-c64e-4695-80af-04f048f86f37`. CLI remains signed source55890b9c; installed Mac UI is1267/source090388f3. No browser/MCP/assistant or Windows UI acceptance is claimed.

The current custom look source was read before use: `local.7594b42a-b8cd-412e-8d16-8b80333e4c10` v1/v2, immutable source hashes9dd5099369fe61be2e77b61943c5b603ffae6e45e604b8c7f8cfa025cf37b82f /354cccd9c71cbef91d2de6e17ff8aa2201adb0e225fc552a31e719e0f79350d5. The folder was independently listed before the create-only CAS with `if_match_hash:null` created `Folder view.textpack`, identity `3c489899-4e8e-4647-841b-2fc1d6221fdc`, revisione891f5e02df1bf9604d6218662a560e00f626ea043706148d17524435c9cb840. This condition could not overwrite an existing definition. Same-key retry returned the same identity/hash; a fresh-key stale null attempt refused and the hash remained exact.

| Owned item | Pinned look | Final server hash |
| --- | --- | --- |
| Existing5789485a-7490-4ab5-8a32-679131b258e4 | custom v1 | 057f265b85cda6338cc47c26b124e5c5f23e6fe0ef65247efe73e63261cec02d |
| Generic13213d8a-e5ad-4055-80b7-0d61e5954015 | custom v2 | de79a6cef1bf986393ead5a501fd28eb824a5c1c5a2a2f3269b90238ab05f658 |
| Explicit15592bd7-4bcf-42fe-8602-472cbcf634f2 | texttext.note v1 | e83eb0a405cce26de63542eb2b719a735f00edfd7531871b4744e5f566ea039c |
| Later generic9dd6db15-81d9-46bc-82b2-1c2fac8c4413 | custom v1 | ebe35618818bb76ab587b185edae2e597e5e60be48b3ea0035c11bbf39560713 |

A guarded switch of the folder default to v1 produced revisione76b79ef1afb13d1ab0261d8d3ebab1b728e9e8d8b44bead50a98bb888855467. Retrying the earlier generic create with its original key returned the original v2 item, not a duplicate or new default. A fresh generic item inherited v1. Finally, guarded restore set the folder default back to v2, revision41f2ec54283e56fdec66cac381c7d6824ffe61954ff4103b918f76da7e5710b5. Existing item hashes/pins above remained unchanged. This ordinary retry test does not inject response loss.

Actual Mac127 UI synchronized the items, displayed the v2 look name for the generic item, a note card for the explicit override, and the original v1 look name for the old item. No edits were made through those views; server hashes remained exact afterward. The app quit normally. Screenshots: `/private/tmp/texttext-t20-folder-default-{generic,explicit-note,pinned-v1}-mac-20261018.png`; operation/read/retry/CAS receipts use the same private texttext-t20-folder-default prefix. Final pin proof: `/private/tmp/texttext-t20-final-default-pinning-proof-20261018.json`.

Retirement was not applied; the earlier proposal expired. Remaining T20 entry points, audit verification, permission cases and actual committed-response-loss behavior retain their separate obligations.
