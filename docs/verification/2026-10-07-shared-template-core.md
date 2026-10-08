# Shared templates and canonical agent gates

Frozen source: `48a3f378`, checked on the Mac with Node 22.19.0 in
`/private/tmp/texttext-shared-XdMxA6`. The clone contains committed source only;
ongoing web assistant edits and unrelated working-tree files were excluded.

`node scripts/with-local-database.mjs node sync/verify.mjs` passed:

- Core: 39 suites, 377 tests, followed by TypeScript.
- Native: the established native sync gate, including shared checkpoint tests.
- Both exact-source receipts use digest
  `77ed151d60a21eb1b1b9cd720bde9f5d734e8e12ca37d3a55eb79f17a8b899a3`.
- Core receipt completed `2026-10-08T04:53:55.883Z`; native completed
  `2026-10-08T04:55:14.542Z`.

Log: `/tmp/texttext-shared-48a3f378-sync.log`. Receipts are in the snapshot's
`.texttext/sync/` directory. No install or deployment was performed.

This covers canonical template application and delivery to active shared editors,
native checkpoint metadata, canonical AI context, and file-based approval previews.
It does not certify later source changes or full web-agent parity.

Subsequent review found a separate approval-result recovery gap after claiming an
approval or after committing the file but before recording its SQL receipt.
Duplicate execution is refused, but recovery is incomplete. That fix is in progress;
do not describe this snapshot as completing agent durability or ship it as such.
