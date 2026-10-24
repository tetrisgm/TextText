# One document path: implementation map

This is the first implementation map for [Finish TextText](../plans/finish-texttext.md). It records current ownership and the narrow seam for replacing duplicate reconciliation. It is not a claim that migration is complete.

| Responsibility | Current code | Keep or replace |
| --- | --- | --- |
| Valid document and file-to-collaboration projection | `src/sync/engine/collaboration.ts`, `src/sync/engine/reconcile.ts`, `src/local-vault/pack.ts` | Keep the validated snapshot, identity and merge rules. Make one shared adapter call them. |
| Editor checkpoint and external-file merge | `src/sync/engine/client.ts` | Keep the persisted journal and external edit merge. Establish this as the shared decision path before removing native code. |
| Server permissions, revision and audit | `src/lib/store.ts`, vault collaboration route | Keep as the connected mutation boundary. A raw file write is not a trusted actor identity or permission grant. |
| Mac file observation, local queue and recovery | `mac/Sources/TextText/LocalVaultWindowController.swift`, `mac/Sources/TextTextFileProviderKit/LocalVaultSync.swift` | Keep active until one shared adapter covers its pending operations and local-only files. Then remove replaced decisions, retaining OS file access and atomic writes. |
| Windows file observation, local queue and recovery | `windows/TextText.Core/SyncEngine.cs` and its partial files | Apply the same migration boundary. Retain the existing journal and conflict data during conversion. |

The first replacement slice is one existing connected document whose file is edited by an external process while its editor is open. Feed the file's persisted baseline, current bytes and editor state through the TypeScript reconciliation path. Project the result to the same document ID; if the edits cannot merge, preserve both contents. Recheck the account's permission before upload. One normal close/reopen and reconnect check covers this slice. Then identify the exact native decision code that becomes unreachable and remove it. No broad sync retest is needed for this map.

The key risk is process lifetime: browser code alone cannot observe file writes while the desktop window is closed. The thin native shell must still watch files and deliver events, or launch a shared local worker. Choose between those only after tracing existing background behavior and pending journals. Do not remove native engines on the strength of browser-only coverage.
