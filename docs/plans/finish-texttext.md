# Finish TextText

Owner direction, October 23, 2026. This is the only active execution plan. It replaces the previous phase plans, completion matrices, handoffs and expansion goals. Git retains their history. This document describes the target, not completed implementation.

## Product and finish line

A notes app with multiplayer and other kinds of content, built on one validated document model. Finish means a person can create, organize, find, edit, share and collaborate on a document; an agent can edit its local file directly; disconnected changes survive reopen and reconnect without silently overwriting another person's edits.

Keep direct file access, MCP and the CLI. Agents must be able to use ordinary filesystem tools without being forced through an API. Keep existing content, assets, privacy, permissions and recovery evidence safe.

## Architecture to simplify toward

Keep the existing TypeScript editor, document schema and Yjs collaboration. Prefer one shared TypeScript file adapter over separate Swift and C# reconciliation engines. This is a direction, not a decision to rewrite everything immediately. C# remains viable if a concrete constraint requires it; do not add Rust or WebAssembly without a demonstrated need.

Files remain writable inputs and readable outputs of the same document system. Document IDs are independent of paths. The shared adapter needs a persisted baseline, detection of external edits, application through document operations, and projection of remote changes back to files without feedback loops. Concurrent file rewrites must merge safely or preserve both versions. An agent's arbitrary local writes are not automatically attributable to a verified agent identity. Permissions must be rechecked before upload.

Application-managed local persistence retains pending edits. Existing filesystem reconciliation cannot be removed until local-only content and pending operations have a safe replacement. Do not delete originals or journals to make migration appear successful.

## Cuts

- Remove bundled agent runtime and provider orchestration from the core app and release dependency chain. External agents use files, CLI or MCP. Do not build another subscription integration project or demand identical capabilities across all entry points.
- Stop advanced template authoring, versioning, retirement and agent expansion. Retain rendering of existing documents and simple built-in content presentations. Remove unused UI and machinery only after checking existing content dependencies.
- Retire duplicated native sync implementations as the shared file adapter replaces their responsibilities. Do not build a general-purpose sync framework or maintain both indefinitely.
- Remove mandatory same-commit three-platform delivery and exhaustive platform/theme/content/interface matrices from ordinary development. Prefer a shared web-delivered product with thin desktop shells; retain local file integration. Shell updates happen when shell behavior changes. Cached app compatibility and offline startup must be explicit before switching delivery.
- Do not continue old numerical performance targets, phase checklists, or deferred template work merely because they exist in history or a stash.

## Work sequence

1. Trace one document's editor, multiplayer, disk and agent-write paths. Select the existing canonical operation path and identify the exact duplicate responsibilities to remove. Produce a small implementation map, not another roadmap.
2. Replace the file adapter for one complete document flow. Exercise an ordinary external file edit concurrent with a person editing, then reopen and reconnect. Use existing recovery code where necessary; remove the replaced implementation once its data has migrated safely.
3. Remove agent runtime coupling and advanced template lifecycle surfaces. Keep MCP, CLI and file editing working through existing document operations. Preserve older content rendering.
4. Simplify delivery and executable release scripts to match this plan. Ordinary product changes should need one deployment; native builds are for native changes. Existing scripts still enforce old gates until actually changed; do not claim the process has been simplified merely by changing this document.
5. Close the core workflow with one real multiplayer/file-edit/save/reopen check. Fix specific failures, then finish. No exhaustive parity campaign.

Independent removal work can run in parallel with the document-path work, with one owner per shared file and one owner of live UI input. Commit coherent changes on main. Preserve the owner's Mac package pin.

## Proportionate verification

Small changes get the relevant check. Add one focused regression for a meaningful bug when it prevents recurrence, not automatically for every edit. Inspect an affected UI flow once. Build changed executable components; perform a short open/save/reopen check when shipping editing or persistence changes. Check multiplayer when collaboration changes. Broader suites are reserved for changes whose storage, permissions or compatibility impact justifies them.

A passing result stays passed until a relevant change invalidates it. Stop repeating an inconclusive automation attempt; distinguish missing observation from a demonstrated product failure. Track unrelated failures separately. Keep product durability and permission guards. Remove giant mandatory release gates rather than bypassing them ad hoc. Documentation-only edits need link and structure checks, not application builds or releases.

## Decisions still requiring evidence

The precise shared-adapter runtime and readable on-disk format, how existing TextPacks migrate without losing assets or pending changes, and desktop cached-app compatibility remain implementation decisions. Do not convert these into new feature projects. If a decision materially sacrifices direct agent file editing, multiplayer, offline durability or existing content, return it to the owner.

## Current status

The first observed external edit now enters the existing TypeScript merge while an editor is open; native background observation, pending journals, and recovery still carry distinct responsibilities. The bundled Codex helper is optional in Mac source builds. The shared gallery and editors no longer offer advanced look authoring actions, though compatibility data actions remain. Ordinary web changes use a web-only release command; Oracle serves `b460f474`. The one final real multiplayer and file-edit closeout has not been performed on these source changes; the Mac build reached signing but its login keychain key was unavailable to SSH.

One-document implementation map: `VaultApp` owns local-only edits and file writes; `VaultDocumentSession` hands a shared file to `FileCollaborationClient`, whose Yjs `mutate` and durable checkpoint are the canonical live collaboration path. The native file observation bridge supplies changed TextPack bytes; `VaultDocumentSession.reconcileObservedFile` now passes those bytes through `FileCollaborationClient.reconcileExternalDocument` into the same Yjs document. Mac and Windows native stores still watch files while the editor is closed, queue uploads, and retain recovery journals. Those background and durability duties are the exact native responsibilities to replace before deleting their engines.
