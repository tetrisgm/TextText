# Claude adversarial architecture review, September 21

Requested by the owner. Read-only Claude Code review of commit 6117c833 and
the personal workspace plan. The reviewer made no repository changes.

## Maintainer adjudication

Confirmed in current source: migration is still default-on in ItemTypeStudio
and both item-type server actions; item and folder gallery entry points expose
different capabilities; folder settings still derive views from a default
item type; the folder picker computes an unused full-post count; studio preview
loads every candidate document. These are consolidation work, not completion.

Corrections to the raw review below:
- B2 incorrectly says the studio has no saved-type picker. ItemTypeStudio
  lines 878 onward provide Edit saved type. Gallery-to-designer integration
  remains absent.
- B6's proposed key removal is insufficient: WorkspaceRootPages lines 831-851
  conditionally replace destination component types. Their state still unmounts
  without the key. Design state ownership before deleting restoration behavior.
- MCP lines cited in A1 forward apply_to_existing; the default must be checked
  in the command schema and shared operation, not inferred from forwarding.
- Do not remove explicit migration, custom collection filters, or restoration
  merely to simplify code. Preserve their intended capabilities under explicit
  controls and verify user journeys. No wholesale rewrite or new content model.

The immediate priority is consistent explicit migration across UI, assistant
and MCP, then independent folder views and one type-library lifecycle.
Performance acceptance is still open. Source-text assertions alone do not
establish working behavior.

## Unedited reviewer output

# Adversarial review: TextText personal workspace

Read: `docs/plans/personal-workspace.md`, `DESIGN.md`, the verification receipt (selectively), and the named implementation. Nothing edited or executed.

**Verdict.** The content model (DocumentSnapshot + DocumentRenderer) is sound and should stay. The incoherence is one layer up: *three* unreconciled ideas of "what a folder is and what it looks like," *two* divergent gallery products behind one component, and a shell that remounts destinations and then spends thousands of lines restoring what the remount destroyed. The September 21 claim that folder/type coupling was "the first removal of coupling" is accurate but narrower than it reads — the coupling was removed from one of three write paths.

---

## A. Verified bugs

**A1 — Creating a custom type from a folder still silently rewrites existing documents.** `ItemTypeStudio.tsx:388-389` defaults `applyToExisting = true` and `saveMode = "folder"` whenever `initialFolderPath` is set. `PostWorkspaceShell.tsx:5229-5232` sets exactly that from the sidebar's "Build with AI". The checkbox at `ItemTypeStudio.tsx:1229-1234` renders pre-checked. `item-type-actions.ts:71` (`applyToExistingInput !== false`) and `item-type.server.ts:85` both default to migrate-on, so `retemplateFolderItems` runs over the folder. `FolderLookPicker.tsx:120` passes `false` — that one path is fixed. The plan's requirement "Folder defaults must not implicitly rewrite existing documents" (`personal-workspace.md:62-64`) is unmet on the create path, the update path (`item-type.server.ts:284`), and the MCP path (`mcp/tools.ts:997,1065`).

**A2 — TemplateGallery is two different products depending on entry point.** `UnifiedDocumentEditor.tsx:1469-1485` passes no `library`, no `onImport`, `onDuplicate`, `onRetire`, or `onRestoreVersion`. The component falls back to `inferredLibrary` (`TemplateGallery.tsx:59-69,125-128`), which fabricates `versions: [definition]` and `impact: {0,0,[]}`. Consequences on the item path: impact reads "Not available" (`:434,:438`), version history never renders (`:528`), every workspace type is labelled "Workspace" so the "Mine" filter shows 0 (`:64,:578-581`), and Import/Retire/Restore are absent. The folder path (`FolderLookPicker.tsx:155-198`) has all of it. This is the "two current gallery entry paths" the plan flags (`:66-67`), and it is worse than duplication — it is one component with two silently different capability sets.

**A3 — Expensive server work computed then discarded.** `folder-template-actions.ts:67-72` calls `getFolderPosts(...).then(items => items.length)`. `store.ts:3446-3452` returns full `Post[]` including bodies. The only caller, `FolderLookPicker.tsx:160`, hardcodes `targetItemCount={0}`. Opening the folder look picker reads every document body in the folder to produce a number nobody displays.

**A4 — Studio folder preview loads the whole folder.** `PostWorkspaceShell.tsx:613-643` iterates *all* candidates in batches of 12 and awaits `ensurePostDocument` for each. Comment says "Bound concurrent reads, not the results" — concurrency is bounded, total work is not. A 500-item folder issues 500 document reads when the user picks "Folder content".

**A5 — Destination highlight lies about type.** `PostWorkspaceShell.tsx:5286` is a single inline ternary chain: an open item maps to `"notes"` only when `post.type === "note"`, otherwise `"profile"`. Open an Article, a bookmark, or any custom type and the bottom bar highlights Profile. Folders fall back the same way via `folder.mode === "notes"`.

**A6 — Folder view choice is not persisted.** `FolderPage.tsx:790` holds `savedViewId` in plain `useState`, and `:795-810` resets it to the type's `defaultView` on folder change. Only the grid/list toggle persists (`:1660-1663`, key `folder:v3:${folder.id}`). Gate 6's "Persist folder view choices" and product decision `:42-43` ("an explicit persisted view choice") are unmet.

**A7 — Mixed folders are filtered by the default type's view.** `FolderPage.tsx:831-842` runs every item through `queryCollectionItems` with `activeCollection.filters`, which come from `defaultTemplateForFolder(folder)` (`:781-784`). A folder holding notes, bookmarks and a Book review type filters *all* of them through Book review's filters. The `showAllItems` escape hatch (`:791-792,:841`) is an acknowledgment of the defect, not a fix. This is the "collection-definition dependency on the default item type" the plan asks to audit (`:68-69`); the audit result is that it is load-bearing and wrong.

---

## B. Architectural concerns (not bugs, but the source of them)

**B1 — Three stacked "appearance" concepts.** `folder.mode` (legacy kind), the folder's default *item type* collection (`FolderPage.tsx:781-817`), and a persisted reader override (`:1652-1663`). On top sits `usesBuiltInLook` (`:827-830`), which switches between two entirely separate renderer implementations — hand-written rows (`:1107`) versus `DocumentCollectionRenderer` (`:1551`). Every type feature must be built twice or it regresses on one path.

**B2 — Four names for one thing.** "look" (gallery copy, enforced by `simplification-contract.test.ts:87-96`), "item type" (`ItemTypeStudio`, sidebar "Edit default type"), "template" (store, `TemplateDefinition`, `setFolderTemplate`), "mode" (`targetType: "mode"` in audit records, `folder-template-actions.ts:125`). The gallery and the studio never link to each other; there is no "edit this type" button in the gallery and no type picker in the studio.

**B3 — PostWorkspaceShell is 5,873 lines with ~170 hook calls.** It owns routing, rails, tabs, assistant, studio, scroll memory, focus memory, capture, and dialogs in one function body. Nothing about it can be tested by mounting it — which is why the "tests" in B4 exist.

**B4 — Source-grep tests are the completion evidence.** 33 test files assert on file *text*. `change-look-entry.test.ts:10` says so outright: "Everything below is reachable only through the shell, which no test can mount here, so this checks the wiring exists." `template-gallery-lifecycle.test.ts:19-20` asserts `expect(gallery).toContain("Import")` — it passes today while the item-path gallery has no import (A2). `simplification-contract.test.ts:136-169` asserts CSS substrings like `"flex-wrap: wrap"`. A green suite here means the strings are present, not that the journey works.

**B5 — Performance evidence does not support the gate.** The receipt's fixture has 17 personal timeline items (`:10`). Warm p95 numbers (`:136-148`) come from that fixture; the plan's own gate requires 5,000 feed items and cold/warm separation. Bookmarks first visits of 306.9/639.6 ms are recorded, and the plan already concedes these "do not pass the performance acceptance gate" — but the checkpoint list reads as a progress ledger, not as an open failure.

**B6 — Restoration machinery compensates for a self-inflicted remount.** `WorkspaceRootPages.tsx:1098` keys `WorkspaceRootLanding` on `${pool.blogId}:${homePane}:${viewsHydrated}`, so every destination switch unmounts the tree. The 250ms/900ms/2.5s settling windows, per-destination scroll maps, and exact-row focus restoration in the checkpoints exist to paper over that. Remove the key and most of that machinery becomes unnecessary.

**B7 — DESIGN.md is layered, not rewritten.** Lines 1-19 state the current direction; lines 21-79 describe a superseded news-only composition in equal detail, including contradictory claims ("The Home feed begins immediately. It has no greeting, Recent column... or assistant panel"). Gate 1 requires "Update DESIGN.md to the agreed composition."

---

## C. Smallest coherent consolidation sequence

Keep DocumentSnapshot, DocumentRenderer, `store.ts` as the only data path, and `TemplateDefinition` as the render authority. No second content model, no rewrite.

**1. Make migration opt-in everywhere (smallest, highest risk removed).** Invert the default in `item-type.server.ts:85` and `:284` to `applyToExisting === true`, and in `item-type-actions.ts:71,207` and `mcp/tools.ts:997,1065`. Default `ItemTypeStudio.tsx:388` to `false` and `:389` to `"version"`. Migration then exists in exactly one shape: an explicit checkbox that already reports `changed/contested/remaining`.

**2. Split "folder default type" from "folder view."** Add a persisted `folder.viewChoice` (layout + saved view id) read by `FolderPage`. Stop deriving `activeCollection.filters` from the default type in `FolderPage.tsx:831-842`; apply a type's filters only to items pinned to that type. **Remove** `showAllItems`/`unfilteredFolderId` (`:791-792`, `:841`, the "Show all items" control) — it becomes meaningless.

**3. Collapse the gallery to one contract.** Make `library`, `onImport`, `onDuplicate`, `onRetire`, `onRestoreVersion`, `onExport` required props. Give `UnifiedDocumentEditor.tsx:1469` the same server-backed lifecycle the folder picker has. **Delete** `inferredLibrary` (`TemplateGallery.tsx:59-69`) and the `library ? ... : "Not available"` branches (`:434,:438`). **Delete** `targetItemCount` plumbing including `getFolderPosts` count in `folder-template-actions.ts:67-72` and the `targetItemCount` field of `FolderLookState`; compute it from `library` impact or drop the row.

**4. One lifecycle entry.** Add "Edit this type" to the gallery preview pane, routing through the existing `readItemTypeForEditAction` + `ItemTypeStudio editing` path currently duplicated only in `PostWorkspaceShell.tsx:5233-5270`. **Remove** that inline handler from the shell into a small `useItemTypeLifecycle` module shared by both entries. Settle on one noun — "type" — and **delete** the `simplification-contract.test.ts:87-96` "call it a look" assertions rather than preserving the split vocabulary.

**5. Stop remounting destinations; then re-measure.** Remove the `homePane` segment from the key at `WorkspaceRootPages.tsx:1098`. Delete whichever scroll/focus settling windows become dead. Bound `loadItemTypeStudioPreviewDocuments` (`PostWorkspaceShell.tsx:613-643`) to the first N rows actually previewed. Only then rerun the destination benchmark against the 5,000-item fixture the plan already requires, and convert the three source-grep contract files (`simplification-contract`, `change-look-entry`, `template-gallery-lifecycle`) into rendering tests of the now-mountable gallery and studio — or delete them. They currently certify strings, and A2 proves they certify strings that are false.

Steps 1-2 are the ones the owner's "not just patch it" demand actually turns on; 3-4 remove the duplication; 5 removes the compensating machinery.
