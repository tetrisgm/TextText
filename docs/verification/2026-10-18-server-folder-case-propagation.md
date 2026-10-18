# Owner-authorized automatic folder case propagation

T13 server/shared planner slice. The original real case-sensitive filesystem reproduction moved individual packs into a differently cased folder, leaving the old empty directory and empty descendant. Its authoritative manifest then contained two folded aliases; native refusal was correct. No blind empty-directory pruning was added.

## Contract

Owner-only `GET /api/vault/:workspace/items` advertises `syncCapabilities: ["folder-case-moves-v1"]` and `manifestRevision`, the raw complete filesystem manifest digest. The existing `revision` remains the permission-aware ETag digest. The owner-only capability participates in the ETag so a same-edit-permission owner downgrade invalidates it.

`POST /api/vault/:workspace/folder-case-moves` accepts exactly:

```
{operationId, source, destination, baseManifestRevision,
 folders: [original source subtree paths including empty descendants],
 items: [{itemId, relativePath, revision}]}
```

The result contains exactly `{operationId,status:"moved",source,destination,folders,items,manifestRevision}`; folders/items are the complete rebased subtree and original item revisions. This narrow automatic lane requires trusted owner authentication, the exact same parent spelling, and distinct leaf spellings with equal NFC/case-folded paths. General folder moves still require owner review. Caller approval flags and future fields are rejected.

## Authority and durable behavior

- The server checks original manifest digest, exact complete subtree topology, document identities/revisions and source problems under the existing workspace engine lock. Concurrent content/topology changes refuse.
- The pure planner uses an explicit `caseOnly` mode; the ordinary planner path still rejects canonical-equal destinations. Distinct folded peers/subtree aliases refuse. Same-parent inheritance stays in place, so no redundant inherited grant is created and no added access is accepted. Existing descendant grants rebase.
- Existing SQL owner/grant reservation, durable folder intent, staged tree rename, metadata completion and audited receipt executor are reused. There is no per-item partial folder publication. Owner authority is rechecked before publication/reservation; SQL grant fingerprints fence changes between planning and reservation.
- Stable request hashes bind owner, operation ID and original command. Completed receipt replay happens before stale manifest/topology validation. Lost audit/response acknowledgement returns the same result without redoing the move. Changed bytes/command with the same operation ID refuse.
- Exact directory entry spellings are checked on case-insensitive filesystems. An old source pathname aliasing the new destination is not misclassified as an original source that authorizes abort/cleanup. The pre-stage destination check permits only the exact authenticated source spelling for explicit case mode; a distinct folded peer remains occupied.
- Pre-intent CAS refusals mutate no server filesystem/receipt; the native caller retains its durable pending command and conflict evidence. Existing reserved/aborted intents retain their durable executor state. No separate server rejection-tombstone format was introduced.

## Gates

- 48 unit/engine/API checks in 10 files pass; unchanged general reviewed move regressions included: `/private/tmp/texttext-folder-case-server-final-unit-20261018.log`.
- TypeScript passes: `/private/tmp/texttext-folder-case-server-final-typecheck-20261018.log`.
- Actual case-sensitive APFS reproduction plus whole-tree/replay/conflict cases: 4 checks pass, `/private/tmp/texttext-folder-case-server-casefs-20261018.log`. Fixed authoritative manifest `/private/tmp/texttext-folder-propagation-casefs-fixed-manifest.json`; original failed fixture is preserved separately. Empty descendants and exact pack/asset bytes survive, and old aliases disappear.
- Local loopback PostgreSQL: existing general metadata/boundary tests plus new case-access test pass (3 tests), `/private/tmp/texttext-folder-case-server-db-20261018.log`. The final new access race test also passes `/private/tmp/texttext-folder-case-server-db-race-20261018.log`: grant mutation after preview refuses before moving, retry with fresh access rebases only the existing descendant row, inherited row unchanged, no extra grant, one audit and one applied move receipt.
- Initial filesystem fixtures exposed and corrected case-insensitive abort misclassification; default-volume distinct-alias mkdir refusal was an environment property, and the distinct-peer case is exercised on the actual case-sensitive volume. No guard was weakened.

Exact 14 implementation/test source hashes: `/private/tmp/texttext-folder-case-server-source-20261018.json`. Relevant docs/Next route-handler and database instructions were read. No production database, deployment or user document was touched.

This receipt does not claim native outbox transport integration, installed app convergence, complete six-client acceptance, arbitrary external filesystem race atomicity or power-loss durability. Native command retention/replay and physical delivery are separate root-coordinated gates. Preserve pending intents/receipts and affected directories on refusal; recover forward through compatible code rather than pruning empty folders or discarding a pending native command.
