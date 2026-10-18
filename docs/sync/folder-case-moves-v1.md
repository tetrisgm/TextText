# Automatic folder casing protocol v1

Scope: an authenticated workspace owner may automatically change one folder leaf's casing within the exact same parent. General folder moves retain the existing owner proposal review. This protocol never prunes an inferred empty source folder or merges distinct folders.

## Capability and wire

The authenticated `GET /api/vault/:workspaceId/items` manifest advertises `syncCapabilities: ["folder-case-moves-v1"]` and `manifestRevision` only for the permitted owner lane. `manifestRevision` is the canonical engine digest, distinct from the permission-filtered `revision` and HTTP ETag. No fallback owner assumption enables the lane.

`POST /api/vault/:workspaceId/folder-case-moves` uses existing authenticated account binding and a strict JSON body:

```ts
{
  operationId: string, // immutable UUID, reused after uncertain/lost replies
  source: string,
  destination: string,
  baseManifestRevision: string,
  folders: string[], // exact original subtree, including empty descendants
  items: { itemId: string, relativePath: string, revision: string }[]
}
```

The successful response is:

```ts
{
  operationId: string, status: "moved", source: string, destination: string,
  folders: string[], // exact rebased subtree
  items: { itemId: string, relativePath: string, revision: string }[],
  manifestRevision: string
}
```

The server checks current owner authority, same exact parent, canonical-equivalent different leaf spelling, complete source topology and source revisions, no occupied distinct folded peer, and unchanged effective access. Descendant grants follow the subtree; an unchanged parent adds no inherited grants. Any access expansion, changed topology, or failed authorization refuses this automatic lane. Existing reviewed planner/executor owns durable filesystem intent, grant reservation, audit, receipt, and partial failure. Actor-bound immutable receipt replay precedes stale CAS checks. The same operation ID with different arguments refuses.

## Native durable observation

An account/root-bound sync state records a versioned complete authoritative folder catalog, source item paths/revisions, canonical manifest revision, and each existing physical directory identity. A first observation is not reconstructed from item renames. Before file reconciliation, the client qualifies exact old spelling absent and a unique same-parent canonical alias with the original physical identity. It verifies the complete local subtree, including empty directories and expected document IDs, with no symlink following or unknown entries.

A fresh authenticated manifest must retain the baseline topology. Ordinary document revisions before command creation may supply fresh source revisions; document content/hash baselines remain independent. Before saving the immutable folder command, the client publishes retained profile floor three, preserving exact profile-v2 and actual displaced bytes. Known floor-two readers then refuse the workspace. Semantic principal and owner version remain unchanged.

The pending command retains source identity, root/account binding, operation UUID, and exact request. Ordinary file sends, path acknowledgements, and new shared joins wait for its receipt. An uncertain reply retains and replays the same request. An HTTP error, including 409, never proves that publication did not occur. It preserves the command and current trees and permits exact immutable replay to discover a completed receipt. Abandonment requires a separate authoritative durable cancellation tombstone; local metadata or status codes cannot authorize it. Existing attempted per-file commands are never rewritten under the same receipt identity.

Only a response matching the complete retained operation and rebased topology permits local item/checkpoint path adoption. Pending shared journal batches, epochs, sequences, and generations remain unchanged. The client checks current local identity/topology again after network awaits. It preserves source content hashes and revisions independently, clears the folder command durably, then refreshes the authenticated manifest. No response authorizes a local overwrite, directory deletion, or rollback.

## Bounded implementation limits

- A folder renamed before its physical identity baseline exists requires review.
- The first Windows implementation requires review if an affected per-file, binary, or shared rename outbox command already exists. It preserves those immutable commands. Pending shared text journal state is supported separately.
- Local unsafe/unreadable/unknown subtree entries or inspection bounds refuse the automatic lane.
- Actual server executor and physical Mac/Windows tests are separate evidence; a native transport fixture alone is not a multiplayer acceptance pass.
