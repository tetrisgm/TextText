# Application parity inventory

Status: initial code-owner inventory; feature-level behavior and visual acceptance remain open. Updated October 11, 2026.

## Application surfaces

| Surface | UI owner | Runtime and adapter boundary | Known difference or open check |
| --- | --- | --- | --- |
| Web | [`WebVault`](../../src/local-vault/WebVault.tsx) mounts [`VaultApp`](../../src/local-vault/VaultApp.tsx); [`/vault/[workspaceId]`](../../src/app/vault/%5BworkspaceId%5D/page.tsx) resolves access before rendering | [`web-transport.ts`](../../src/local-vault/web-transport.ts), [`web-watch.ts`](../../src/local-vault/web-watch.ts), browser storage and tab ownership | Web session remounts on a second same-workspace tab; verify multi-tab recovery and all product flows |
| Mac | [`WebAppWindowController.swift`](../../mac/Sources/TextText/WebAppWindowController.swift) hosts the shared web application in WKWebView | [`LocalVaultWindowController.swift`](../../mac/Sources/TextText/LocalVaultWindowController.swift), [`LocalVaultConnectionController.swift`](../../mac/Sources/TextText/LocalVaultConnectionController.swift), [`LocalVaultSync.swift`](../../mac/Sources/TextTextFileProviderKit/LocalVaultSync.swift) and `LocalVaultCollaboration`; Apple sign-in, menus, file coordination and extensions remain native | Verify exact installed app/web bundle identity and native-only flows, including share extension and account transitions |
| Windows | [`MainWindow.cs`](../../windows/TextText.Windows/MainWindow.cs) loads the packaged WebView2 application; [`VaultApp`](../../src/local-vault/VaultApp.tsx) owns the workspace UI | [`WindowsBridge.cs`](../../windows/TextText.Windows/WindowsBridge.cs), [`SyncEngine.cs`](../../windows/TextText.Core/SyncEngine.cs), Windows credential, filesystem and window adapters | Installed candidate startup is verified in [Packet A/B progress](2026-10-11-packet-a-b-progress.md); existing workspace and ordinary-use acceptance remain open |

## Feature owner map

| Feature family | Shared behavior owner | Platform adapters or separate path | Acceptance status |
| --- | --- | --- | --- |
| Workspace navigation, folders, item listing, creation and search | `VaultApp` and shared workspace components under `src/local-vault/` and `src/components/workspace/` | `vaultRequest` dispatches through web transport or native bridge | Code ownership is shared; verify List/Cards, keyboard, narrow-window and search invalidation on all installed clients |
| Document schema, template rendering and editing | [`DocumentRenderer.tsx`](../../src/components/document/DocumentRenderer.tsx), `UnifiedDocumentEditor`, validated `DocumentSnapshot` and template schemas | Native file reads/writes use WebKit/WebView bridges; browser uses the web transport | Shared renderer is present; full template create/edit/preview/version workflow acceptance is open |
| Live shared text | [`sync/engine/client.ts`](../../src/sync/engine/client.ts), Yjs and shared reconciliation | Browser journal, Mac native checkpoint, Windows native checkpoint | False browser acknowledgement regression fixed; Packet B persistence contract is incomplete |
| Background file sync and external filesystem changes | Shared TextPack and reconciliation model; see [`sync/README.md`](../../sync/README.md) | Mac [`LocalVaultSync.swift`](../../mac/Sources/TextTextFileProviderKit/LocalVaultSync.swift) and Windows [`SyncEngine.cs`](../../windows/TextText.Core/SyncEngine.cs) still contain independent native policy and durable queues | Policy consolidation and external-write race matrix remain open |
| Accounts, permissions and workspace sharing | Shared server access checks, `VaultApp`, and workspace command registry | Mac/Windows native sign-in and credential stores; web session and server grants | Two-account edit/read/revoke/re-grant acceptance remains open |
| Comments, assistant and agent commands | Shared workspace UI and command schemas; [`ai-sidebar-architecture.md`](../ai-sidebar-architecture.md) | Native Codex adapter, web assistant, CLI, hosted MCP and platform bridge | Shared command contract exists; full real-entry-point workflows and parity checks remain open |
| Window lifecycle, menus, OS integration and filesystem coordination | Shared browser event hooks where applicable | WKWebView controller and extensions on Mac; WPF/WebView2, activation and close guards on Windows | Windows activation and close ordering has controlled smoke coverage; installed normal-use and Mac lifecycle gates remain open |

## Architecture findings

- The same workspace UI and validated document model are used across the three surfaces. UI sharing is not yet equivalent to shared lifecycle ownership: `CollaborativeVaultEditor` still creates the collaboration client as part of the editor lifetime.
- Browser, Mac and Windows durability adapters differ by design. Browser persistence, native checkpoints and file materialization need one typed contract, while retaining platform-specific filesystem primitives.
- Mac `LocalVaultSync.swift` and Windows `TextText.Core/SyncEngine.cs` both implement background file synchronization policy. The shared Yjs client does not replace those engines; a policy migration needs an explicit runtime decision and adapter conformance evidence.
- The public workspace pages and the authenticated `/vault/[workspaceId]` application are distinct routes. Do not treat public reading as the native app home route. Audit the owner’s older home-route expectation against the current installed behavior before removing either path.
- No parity row is accepted from code presence alone. Installed light/dark behavior, editing, search invalidation, comments, sharing, templates, agents, recovery, account changes and platform input conventions still require receipts.

## Next actions

1. Finish Packet B's transactional browser persistence design and failure/migration coverage.
2. Inventory the route and all entry points per feature (UI, native shell, CLI and hosted MCP), marking shared path, adapter, legacy duplicate or missing path.
3. Make the supported no-editor coordinator/runtime decision with startup, packaging, offline, shutdown, memory and security tradeoffs before adding a runtime.
4. Consolidate native sync policy only in bounded vertical slices after ownership and adapter contracts are proven.
