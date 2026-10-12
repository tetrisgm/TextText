# Shared document runtime decision

Status: chosen for the current architecture; implementation remains in Packet C/D. October 11, 2026.

## Decision

Keep active document coordination in the shared TypeScript application runtime already hosted by the browser, WKWebView and WebView2. Do not add a Node, daemon, or second embedded runtime for Yjs coordination. Native code remains an adapter for filesystem coordination, credentials, durable checkpoints, window lifecycle and platform sign-in.

When no document editor is open, there is no per-document Yjs actor to keep alive. Browser-only workspaces need no local file mirror in that state. Mac and Windows continue their existing native file-sync services so ordinary TextPack changes can materialize while the editor is closed. Opening a document reacquires ownership, reads its materialized baseline and durable journal, and reconciles before accepting new writes. This keeps inactive collaboration traffic and document memory bounded without disabling the native file-sync path.

## Runtime boundaries

| Surface | Active document owner | Durable local boundary | No-editor behavior |
| --- | --- | --- | --- |
| Web | Shared page runtime; browser lock fences competing tabs | IndexedDB transaction; persistent-storage request where available | No document client; server remains authoritative |
| Mac | Shared page runtime in WKWebView | Native checkpoint and coordinated TextPack write; browser journal is an additional recovery copy | Native `LocalVaultSync` continues file materialization |
| Windows | Shared page runtime in WebView2 | Native checkpoint and atomic TextPack write; browser journal is an additional recovery copy | Native `SyncEngine` continues file materialization |

The editor is a view, not the durability owner. Packet C must move the client/session lifetime out of React view effects while keeping the runtime in the same shared page. The coordinator must fence releases with workspace, item and lifecycle identity; flush the accepted generation before native close; preserve journals on genuine storage failure; and stop presence/transport work after release. Multiple browser tabs and native windows remain separate processes and require explicit existing lock/session fencing, not an assumed module singleton.

## Tradeoffs and constraints

- This uses the existing offline-capable UI bundle and adds no runtime package, daemon, startup service, or new credential boundary.
- The shared page can be absent while the app window is closed. Native sync remains responsible for background filesystem work; it must not mutate an actively leased collaboration file without the existing fencing protocol.
- A browser page with no open document does not promise background synchronization of browser-only content. Server state is retained, and the document reconciles on its next open.
- Separate native sync policies remain on Mac and Windows until Packet D moves their portable policy in verified slices. This decision does not declare those implementations equivalent.
- If future requirements need document collaboration while no UI page exists, revisit this decision with measured startup, packaging, memory, shutdown and credential-security costs before introducing a long-lived runtime.

## Acceptance required before implementation is complete

1. Deterministic tests prove open/release, duplicate opens, stale callback fencing, crash takeover and offline reopen for the coordinator.
2. Native and browser adapters conform to the typed persistence and lifecycle contract.
3. Mac and Windows background file sync continues while no editor is open and yields to an active collaboration lease.
4. Browser tab recovery after reload and competing-tab ownership are verified in a real browser.

See [the application parity inventory](application-parity-matrix.md) and [the execution plan](../plans/shared-app-durability-execution.md).
