# Fresh-item lifecycle contract: read-only characterization

No source edits, tests, requests, data writes, generations or fixtures were created. This is source/API-fixture evidence, not new physical acceptance.

## Established behavior

- `src/sync/engine/store.ts:2388–2395` reads the lifecycle control file; without it the manifest omits lifecycle. Only actual restore publishes that control record (`654`) and inserts `texttext-lifecycle.json` into the restored archive (`707`). Fresh nonrestored items genuinely have no generation marker.
- Absence is meaningful on the existing binary-entry API: its `expectedLifecycle: null` is compared with actual null under the server lock (`store.ts:941,973–975`; binary route `65,76`). The existing `server-collaboration.test.ts:70–97` covers fresh-null success and refusal after restore.
- Move PATCH has no expectedLifecycle field. `items/[itemId]/route.ts:166–183` accepts operation ID, encoded base path, If-Match full revision and destination. `VaultEntryMutation`, EntryIntent and immutable request hash omit lifecycle (`store.ts:69–77,559`); server apply checks nondeleted identity, exact source path and exact full archive hash (`489`). Native protected-rename request DTOs likewise have no lifecycle wire field.
- Fresh server moves already work: `src/lib/vault/server-store.test.ts:399–410` creates a fresh pack, moves exact bytes, replays the same receipt and rejects the stale path. This is not a general inability of the server to rename fresh items.
- Supported restore changes bytes/revision and fences older writers: `server-trash.test.ts:26–35` asserts the new revision and old-file/collaboration refusals; marker preservation is covered at `38–49`. Thus old full-revision CAS provides an existing supported restore fence. Current nonnull native renames use this same wire CAS; lack of a move lifecycle parameter alone does not prove a new endpoint is required.

## Delivered native limitation

Mac DTO lifecycle is optional (`LocalVaultSyncTransport.swift:30`); lifecycle adoption processes only nonnull generations (`LocalVaultSync.swift:1843`). Both `mirror-shared-path.ts:52` and `mirror-saved-rename.ts` require known nonnull equal generations for admission. Mac stage-new also unwraps lifecycle (`Sync.swift:749`), and its durable saved record requires a string (`LocalVaultSharedRename.swift:160,173,212`).

Consequently authoritative fresh-server absence and native unknown are collapsed into nil. A fresh active-editor naming debt stays local/HOLD rather than dispatching the mirror move. The clean-checkpoint fix preserves the local name and editor reopen readiness; it does not resolve fresh-item path synchronization. Deploying current server code alone does not create missing generations. No null==null relaxation, synthetic sentinel or live restore/backfill is justified by this note.

## Unapproved future bounded option

An explicit observed-absence discriminant could be investigated using an authoritative complete manifest plus exact local pack evidence, immutable retained command, post-await scope/identity/path/content revalidation and retention of old ambiguous records as unknown. Existing full-revision CAS/restore invariants may permit a solution without a new endpoint, but that requires reviewed contract/tests; this read does not prove all delayed/replayed/restore races or approve implementation. First finish the ordered installed1273 known-generation rename acceptance.
