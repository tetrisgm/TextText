# Verified Claude Fable 5.1 adversarial review

Requested model: `claude-fable-5-1`. Returned modelUsage key and canonicalModel:
`claude-fable-5-1`, provider `firstParty`, successful result, 74 turns.
Reviewed HEAD: `e6b8a535`. Read-only tools: Read, Glob, Grep. No fallback model.
Raw local result: `/tmp/texttext-fable51-adversarial.json`.

This supersedes the unverified-model attribution of the earlier Claude review.
Findings are review evidence, not implementation or runtime proof. Recommendations
require behavior and performance checks, especially replacing folder renderers
and preserving destination state. The explicit migration and discarded-count
findings from the previous review are confirmed fixed.

## Reviewer report

# Adversarial architecture review, HEAD e6b8a535

Read-only. I read the plan, DESIGN.md, the verification receipt and the prior review, then checked every claim against current source. Nothing was executed.

## Verdict

The explicit-migration work landed and is consistent across all callers. That closes the highest-risk item from the previous review. What remains is structural: folder presentation is still derived from the folder's default item type, the type gallery is still two products behind one component, and destinations still remount on every switch. The plan's own acceptance gates for performance and completion are not met, and the receipt says so honestly.

## Stale findings rejected

- **A1 (migration default-on)** is fixed. `ItemTypeStudio.tsx:388-389` starts with migration off and version-only scope. `item-type.server.ts:85` and `:284`, `item-type-actions.ts:71` and `:207`, `folder-template-actions.ts:254`, `mcp/tools.ts:1186` and the tool schemas at `ai/tools.ts:640-642` and `:727-729` all require literal true.
- **A3 (discarded folder count query)** is fixed. `folder-template-actions.ts:58-80` no longer calls `getFolderPosts`, and `FolderLookState` has no count field. The `getFolderPosts` callers left are public rendering and categories, which need bodies.
- **B2's "no saved-type picker"** was already corrected by the maintainer. `ItemTypeStudio.tsx:877-902` has it.

## Verified findings, prioritized

**1. Folder view is still the default item type's view.** `FolderPage.tsx:781-784` resolves the collection definition from `defaultTemplateForFolder(folder)`, which at `UniversalItemComposer.tsx:112-123` is the folder's default template or a mode-derived built-in. Every row in the folder is then filtered through that type's saved-view filters at `:831-842`. The view choice itself is plain component state at `:790` and resets to the type's default when the folder changes at `:795-810`. Nothing in `schema.ts:586-595` stores a folder view choice. The only persisted layout is the grid/list toggle at `:1660-1663`. The plan's product decision "an explicit persisted view choice" and the September 21 direction to "make view choice independent" are unmet. The "Show all items" control at `:906-913` is a workaround for filtering a mixed folder through one type's filters.

**2. Two renderers per folder, chosen by whether the type is built in.** `FolderPage.tsx:827-830` computes `usesBuiltInLook`, then branches at `:921`, `:960`, `:1107` and `:1234` to hand-written row renderers when true and to `DocumentCollectionRenderer` at `:1331` otherwise. `folder.mode` appears seven times in this file as a third input. Any list feature, keyboard behavior or metadata change has to land in both paths or silently regress in one. This is the load-bearing cause of finding 1.

**3. The gallery remains two products.** `UnifiedDocumentEditor.tsx:1469-1485` passes no `library`, `onImport`, `onRetire`, `onDuplicate` or `onRestoreVersion`. `TemplateGallery.tsx:125-128` then falls back to `inferredLibrary`, which fabricates a single version and zero impact at `:59-69`. On the item path, impact reads "Not available" at `:434` and `:438`, version history never renders (`:528`), and the "Mine" count at `:578-581` is always zero because every workspace type is labelled "workspace" at `:64`. `library=` is passed only from `FolderLookPicker.tsx:158`. The receipt at lines 696-712 confirms import was verified only via the folder path.

**4. The gallery and designer still do not link.** No gallery control opens the designer, and the only "edit this type" entry lives inline in `PostWorkspaceShell.tsx:5233-5270`. The designer's own picker at `ItemTypeStudio.tsx:877-902` duplicates that read-and-open logic. Import, duplicate and restore create definitions that appear in the gallery but can be opened in the designer only if their exported source survived, per receipt lines 714-728. "One type library/designer lifecycle" is not yet present.

**5. Studio folder preview reads every document in the folder.** `PostWorkspaceShell.tsx:613-643` iterates all candidates in batches of twelve and awaits a document read for each. The comment says the bound is deliberate so filters see all matches. The trigger at `ItemTypeStudio.tsx:468-494` fires on every switch to Folder content. For a large folder this is an unbounded client-side body fetch on an interactive path, contrary to the plan's "no body fetch per list row" rule.

**6. Destinations remount on every switch.** `WorkspaceRootPages.tsx:1098` keys the landing on `homePane`. `WorkspaceRootLanding` owns deep search, library open state, sort and start-here state at `:291-307`, all lost per switch. Content survives only because `HomeSession` is created outside the key at `:1076`. The scroll settling windows in `scroll-restore.ts:5-8` and the mutation-observer focus restore in `useListReturnFocus.ts:8-37` exist to reconstruct what the remount destroys. The maintainer's caution is correct: removing the key alone is insufficient because `:831-851` switches component types per pane. Shared state must be lifted first.

**7. Destination highlight is wrong for non-note items.** `PostWorkspaceShell.tsx:5286` maps an open item to Writing only when its type is `note`; articles, bookmarks and custom types highlight Profile. Folders map by legacy `folder.mode`. `ArtifactPane` at `ArtifactNavigation.tsx:5` has `bookmarks` and `news`, but this ternary never emits them for items.

**8. Migration bound is opaque to callers.** `store.ts:1776` caps a pass at 500 and reports `remaining`. The designer surfaces it at `ItemTypeStudio.tsx:1241-1244` and the shared operations return it, so this is acceptable. The gap is that the pre-filter at `:1777-1805` loads and maps every row in the folder before slicing, so the read side is still unbounded even though writes are bounded.

## Evidence assessment

- **Performance.** Receipt lines 6-31 and 130-149 use a fixture of 17 timeline items and one bookmark. Warm p95 for Home, News, Writing and Bookmarks is under 200 ms, but first visits reach 306 to 639 ms, and the receipt states the p95 gate is not passed. The 5,000-item suite (line 183) proves server query bounds, not UI navigation. Cold launch, article/back, folder and channel timing are open. This does not prove the plan.
- **Source-grep tests as completion evidence.** 56 test files read source text. `change-look-entry.test.ts:9-10` says so explicitly. `template-gallery-lifecycle.test.ts:19` asserts the string "Import" exists and passes while the item path has no import. `simplification-contract.test.ts:87-96` mandates "look" vocabulary in the gallery while the studio says "Item type" and the sidebar says "default type". These certify strings, not journeys.
- **DESIGN.md** still carries the superseded news-only composition at lines 21-94 alongside the current direction. Gate 1 asks for an updated design, not a layered one.

## Architectural concerns versus uncertainties

Concerns 1 through 4 are structural and cause the bugs. Finding 6 is structural but must be sequenced after state ownership is clarified. Uncertainties: I did not measure the studio preview cost or the remount cost; both are inferred from code. I could not confirm whether any folder in the owner's data has a non-built-in default with active filters, which determines how visible finding 1 is today.

## Implementation sequence

Keep DocumentSnapshot, DocumentRenderer, `store.ts` as the data path and `TemplateDefinition` as the render authority. Additive migrations only.

1. **Persist folder view independently.** Add nullable `view_layout` and `view_id` columns to folders with an additive migration. Backfill nothing. Read them in FolderPage; fall back to the default type's `defaultView` only when null. Apply a type's saved-view filters only to rows pinned to that type. Remove `unfilteredFolderId`, `showAllItems` and the "Show all items" empty-state action at `FolderPage.tsx:791-792, 841, 906, 913`, and the shell assertion at `simplification-contract.test.ts:104`.
2. **One folder renderer.** Route built-in folders through `DocumentCollectionRenderer` with built-in definitions, then delete the `usesBuiltInLook` branches at `:827-830, 921, 960, 1107, 1234`. Keep `folder.mode` for permissions, subscriptions and creation defaults only.
3. **One gallery contract.** Make `library` and the lifecycle callbacks required. Add a shared `useTemplateLibrary(handle)` hook wrapping the existing folder-template actions, used by both `FolderLookPicker` and `UnifiedDocumentEditor`. Delete `inferredLibrary` and the "Not available" branches. Delete `targetItemCount`.
4. **One lifecycle entry.** Add "Edit type" to the gallery preview pane calling `readItemTypeForEditAction`, and move the handler at `PostWorkspaceShell.tsx:5233-5270` into that hook. Remove the duplicate loader in `ItemTypeStudio.tsx:877-902` in favor of the same function. Pick "type" as the noun and delete the "look" vocabulary test at `simplification-contract.test.ts:87-96`.
5. **Bound the studio preview.** Query the folder's existing list projection with fields, and read at most the first N previewed documents. Replace `loadItemTypeStudioPreviewDocuments` at `PostWorkspaceShell.tsx:613-643`.
6. **Fix pane highlighting** by deriving it from the same authored-writing classification Writing uses, replacing the ternary at `:5286`.
7. **Stop remounting, then measure.** Lift `libraryOpen`, `sort` and deep-search state into `HomeSession` or the shell, render all panes through one stable subtree, then drop `homePane` from the key at `WorkspaceRootPages.tsx:1098`. Remove settling windows that become dead. Only then rerun destination timing against the 5,000-item fixture and record cold and warm separately.
8. **Replace string tests.** Convert `change-look-entry`, `template-gallery-lifecycle` and the gallery assertions in `simplification-contract` into render tests of the now-shared gallery and hook, or delete them.

Steps 1 and 2 are what the owner's consolidation demand turns on. Steps 3 and 4 remove the duplicated lifecycle. Steps 5 through 7 remove compensating machinery and make the performance gate measurable.