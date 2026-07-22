# Texttext: Superhuman UI refinement batch (workspace nav, focus, sidebar, home, action bar, Mac menu bar)

Work in `~/dev/write`, branch `main`. Web = Next.js App Router (`src/`). Native mac app = `mac/` (SwiftPM). This is a design-refinement batch on the SIGNED-IN OWNER WORKSPACE (the blog view at `/u/[username]` and `/t/[handle]`: home/root landing + folder pages + editor), plus a few Mac menu-bar actions. Do NOT touch the public reader craft, collab, MCP, or the sync API.

## Design vibe (apply to everything)
Superhuman / Apple HIG: keyboard-first, mouse optional; minimal chrome; content is the hero; sub-100ms perceived speed (no new network on hot paths). Copy is verb-first, sentence case, 1-3 words. Every color works in BOTH light and dark (DESIGN.md: accent rule, 60% ink contrast floor, 0.18s motion; aria-hidden marks may use raw accent with a fallback). NO em dashes anywhere in copy, prose, or docs. Read DESIGN.md before touching reader/editor styles. Every governing CSS rule for the workspace chrome lives in `src/styles/broadsheet.css`.

## Hard constraints (contracts; violating any is a failure)
- `src/lib/store.ts` is the ONLY content access point; notes and bookmarks are unlisted FOREVER; every mutation audits. Do not weaken any of this.
- Do not break the command system, collab (`src/lib/collab/*`), MCP (`/api/mcp`), or the sync API. Do not regress existing keyboard shortcuts other than the specific ones this brief changes.
- The File Provider mount is the SOLE writer in the Mac GUI: create/update ONLY through the sync API (`ServerClient.postFile`), never by writing the mount.
- `PostWorkspaceShell.tsx` is ~7000 lines and was edited earlier today by another process; line anchors below may have drifted a few lines. ALWAYS re-grep the named symbol (given for each item) rather than trusting the raw line number.

---

## GROUP 1 - Keyboard navigation model (the spine; do this first, several items depend on it)

### 1A. Introduce an explicit "active region" so arrow keys never affect two regions at once
BUG (owner): "when I go on the left sidebar by pressing left and I go down, it also moves in the body and highlights the items there. That should never be the case. I am either in the body or on the sidebar."
ROOT CAUSE: `src/components/keyboard/CommandLayer.tsx` attaches its `window` keydown listener in the CAPTURE phase (`addEventListener(..., true)`, ~:308) so it fires BEFORE the sidebar's own bubble-phase `onSidebarNavKeyDown` handler (`PostWorkspaceShell.tsx` ~:1147-1192, wired at the `<nav>` ~:1574). `dispatchCommandShortcut` (CommandLayer ~:238-256) therefore runs `selection.previous/next` (`src/lib/commands/workspace.ts` ~:336-356 -> `ctx.workspace.selectSpatial("up"/"down")`, `PostWorkspaceShell.tsx` ~:5930-6025) which mutates the BODY `selectedPostId` even while the caret/focus is in the sidebar. There is no "which region is active" concept.
FIX: add a single source of truth `activeRegion: "body" | "sidebar"` (state on the shell). `focusWorkspaceBody` (~:5895) sets it to `"body"`; `focusWorkspaceSidebar` (~:5902) sets it to `"sidebar"`. In the command context, gate the arrow/j-k selection commands so `selection.previous/next/left/right` and `selection.extend-*` act on the sidebar roving-focus when `activeRegion==="sidebar"` and on the body listbox when `activeRegion==="body"` - never both. The cleanest implementation: route ALL vertical arrow nav through ONE handler that branches on `activeRegion`, and delete the now-redundant duplicate path (either fold `onSidebarNavKeyDown`'s Up/Down into the command layer, or have the command layer early-return sidebar keys to the sidebar handler and stop dispatching body selection). Left-arrow moves body->sidebar (already `shouldMoveSelectionIntoSidebar`, `workspace-navigation.ts` ~:113-123); right-arrow moves sidebar->body (already `onReturnToBody`->`focusWorkspaceBody`). Ensure entering a region sets `activeRegion` accordingly.
ACCEPTANCE: with focus in the sidebar, Up/Down move ONLY the sidebar highlight; the body's `selectedPostId` does not change. With focus in the body, Up/Down move ONLY the body selection. Verify no double-highlight in either direction.

### 1B. Click an empty region to focus it; selection starts inactive then the first move re-activates the remembered item
OWNER: "If I click an empty area on the sidebar, I want the sidebar to be focused so I can start moving up and down. Inversely, if I click the body, then I'm focusing the body; I would make it unselected at first, but remember the last selected item so that when I start moving, it selects the items. This start-unfocused-then-move-activates should be the general behavior for any area including the left sidebar."
CURRENT: clicking empty `.post-editor-content` runs `beginBackgroundSelection` (`PostWorkspaceShell.tsx` ~:6461-6544, pointerdown ~:6640) gated by `shouldClearWorkspaceSelection` (`workspace-navigation.ts` ~:125-135). There is no "remember last, re-activate on first move" behavior, and no region-focus-on-empty-click for the sidebar.
FIX: (a) clicking empty sidebar space sets `activeRegion="sidebar"` and focuses it WITHOUT changing the highlighted row; clicking empty body space sets `activeRegion="body"` and CLEARS the visible active highlight but stashes the last active id in a ref (`lastActivePostIdRef`). (b) The first subsequent arrow/j-k in that region does NOT step; it RE-ACTIVATES the remembered item (restores the highlight where it was). The second move steps normally. Apply the identical "inactive until first move re-activates remembered position" pattern to BOTH regions. Keep multi-select (`selectedPostIds`) semantics intact.
ACCEPTANCE: click blank body -> nothing highlighted -> press Down -> the previously-active item re-highlights (not the first item, not item+1) -> press Down again -> steps to the next. Same for the sidebar.

### 1C. Remember the sidebar position across region switches
OWNER: "remember the position I was on the left: if I press left to go to the sidebar, move up and down, press right to go back and do stuff, then go left again, I should land at the last position I was."
FIX: persist the last focused sidebar row (`focusSidebarRow`, `PostWorkspaceShell.tsx` ~:1118-1145; sidebar highlight state `selectedSectionPath` ~:4653) in a ref; when left-arrow / empty-sidebar-click re-enters the sidebar, restore that row rather than resetting to Home/top. Combine with 1B (first move re-activates the remembered row).
ACCEPTANCE: navigate to the 4th sidebar item, go right into the body, do things, press left -> the 4th sidebar item is focused again.

### 1D. Cmd+number = jump to the Nth navigation target (works anywhere); plain number = open the Nth item in the current list
OWNER: "the shortcut to navigate to a specific folder is command plus a number. Command-1 is Home, then sequentially. This works anywhere." AND "on the home, if I press a number, I'm opening the corresponding numbered item; in the recents list the first item if I press 1, exactly the same as when I go inside a folder."
CURRENT: plain digits 1-9 are ALREADY bound (`workspace.ts` ~:408-423, `navigation.item.${n}`, `key: String(index+1)` -> `openItemByIndex`, `PostWorkspaceShell.tsx` ~:6057-6069). But on `root` (home) `openItemByIndex` calls `openSectionByIndex` (~:6047-6055) which opens the Nth ROOT SECTION (Blog/Notes/Bookmarks), NOT the Nth Recent item. No Cmd+digit binding exists (only ⌘K etc.).
FIX:
- ADD `Cmd+1..9` bindings (`meta: true`) -> a new `navigateToNavTargetByIndex(n)`: index 1 = Home, then the sidebar navigation targets in their visible top-to-bottom order (Home, then the folder tree rows, then Starred/Shared/Trash as they appear). This works from ANY view level. Reuse the sidebar's ordered node list so numbering matches what the eye sees.
- CHANGE plain-digit behavior on `root` so N opens the Nth item of the RECENT list (the `recent` memo, `PostWorkspaceShell.tsx` ~:2331-2361, rendered ~:2789-2807), matching the in-folder behavior (inside a folder, plain N already opens the Nth visible post). Keep plain-N inside folders as-is.
ACCEPTANCE: ⌘2 from anywhere jumps to the 2nd sidebar target. On home, `1` opens the first Recent item (not the Blog section). Inside a folder, `1` opens the first item (unchanged).

### 1E. "E" must not open Settings on Home
BUG (owner): "Pressing E on the home should not open the settings screen."
ROOT CAUSE: `post.edit` (`workspace.ts` ~:499-509, key `e`/`F2`) -> `editCurrent` (`PostWorkspaceShell.tsx` ~:6129-6142) which has `if (current.level === "root") navigateSettings()` (~:6139-6141).
FIX: remove that `root -> navigateSettings` branch. On `root`, `E` should either do nothing or edit the currently-active Recent item if one is active (prefer: do nothing when nothing is active; edit the active item when one is). Settings remains reachable via its own command (`workspace.settings`, ~:570-576) and the gear UI.
ACCEPTANCE: pressing E on Home does not open Settings.

### 1F. Backspace from a Recent-opened item returns to Home, not up one folder
BUG (owner): "When I open an item from Recent and press backspace to navigate up, I should go back to Home where Recent was, rather than up one folder."
ROOT CAUSE: opening a Recent item on Home calls `openPostId` (~:5746-5761) -> `openPoolPost` (~:5029-5079) which resolves the item's REAL folder as `nextFolderPath` and leaves `returnToSearch` undefined (because the origin view was `root`). `navigateUp` (~:6184-6193) -> `workspaceHierarchyUpTarget` (`workspace-navigation.ts` ~:137-160) then returns `{kind:"folder", folderPath: view.folderPath}`.
FIX: add an origin marker to the post/edit view variant (`WorkspaceHierarchyView`, `workspace-navigation.ts` ~:13-18), e.g. `openedFrom: "root" | "folder" | "search"`, set in `openPoolPost` when the current view level is `root`. In `workspaceHierarchyUpTarget`, when `openedFrom==="root"`, return the root/home target instead of the item's folder. Keep the existing `returnToSearch` behavior for search-opened items.
ACCEPTANCE: Home -> open a Recent item -> Backspace -> lands back on Home (Recent visible), not inside that item's folder.

---

## GROUP 2 - Left sidebar

### 2A. Collapse folder-row hover actions into a single 3-dot menu that replaces the count on hover
OWNER: "move the action of creating a subfolder or sharing into three dots. When I hover, replace the number of items on the right of that line with the three dots."
CURRENT (`PostWorkspaceShell.tsx` `FolderTreeNav.renderNode` ~:1373-1496): the row shows a count pill `.post-editor-folder-count` (~:1451-1455) on the right; on hover two separate buttons fade in: create-subfolder `.post-editor-folder-add` (~:1422-1439, `+`) and share `.post-editor-folder-share` (~:1440-1450). CSS in broadsheet.css: count ~:2702, add ~:2643/2659, share ~:2671/2685.
FIX: on row hover, HIDE the count pill and show a single `.post-editor-folder-more` 3-dot (`···`) button in its place (same right slot, same width so the row does not shift). Clicking it opens a small menu with: New subfolder (gated `canManageFolders && canNest`), Share (gated `canManageSharing`), and Rename (see 3D - move folder rename here too). Reuse the existing menu styling used by the folder action bar (`.folder-action-menu` / `.folder-action-menu-item`, broadsheet.css ~:3156-3194) or the item `···` menu, whichever is closer, so it feels native. Remove the two standalone hover buttons.
ACCEPTANCE: at rest the row shows its count; on hover the count is replaced in place by a `···` that opens New subfolder / Share / Rename. No layout shift.

### 2B. Reduce the left padding of sidebar row icons; align icons + calendar with the workspace name
OWNER: "too much padding on the left of the icons in the sidebar for Home and the folders. Align with the name of the workspace, and align the calendar with this too."
CURRENT: row indent is INLINE `const indent = 8 + depth * 15` -> `style={{ paddingLeft: indent }}` (`PostWorkspaceShell.tsx` ~:1380/1385); base row `.post-editor-folder-row` broadsheet.css ~:2549 (`padding: 2px 8px 2px 0`); the icon sits in `.post-editor-folder-main` (`gap:8px; padding:7px 3px`, ~:2599) with `.post-editor-folder-icon` (~:2618). The calendar `.post-editor-calendar` is `SidebarActivity` (~:998-1095), CSS broadsheet.css ~:2735-2822.
FIX: establish ONE consistent left gutter for the sidebar so the leading icon's left edge lines up with the workspace/name header text above it. Reduce the base indent (the `8 +` and/or the `.post-editor-folder-main` left padding) so depth-0 rows align to the workspace name. Apply the SAME left inset to the calendar block so its left edge matches the folder icons. Verify depth nesting (`depth*15`) still reads as a clear hierarchy after the base is reduced.
ACCEPTANCE: Home icon, folder icons, and the calendar all share a left edge aligned to the workspace name; nesting indentation still legible in light and dark.

---

## GROUP 3 - Home (root landing) + folder action bar

### 3A. Remove the folder tiles from the Home body (they live in the sidebar already)
OWNER: "remove the folders from the body in the home; we have them on the left, it's fine."
CURRENT (`WorkspaceRootLanding`, `PostWorkspaceShell.tsx` ~:2233; body else-branch ~:2667-2811): `.workspace-root-sections` listbox (~:2686-2764) renders a Starred pseudo-tile (~:2692-2723) + a `.workspace-root-section` button per folder (~:2724-2763), under a `<h1>Folders</h1>` + sort `<select>` header (`.workspace-root-folder-header` ~:2669-2685). CSS broadsheet.css ~:3234/3261/3268.
FIX: remove the `.workspace-root-sections` folder-tiles block AND its `Folders` header/sort from the Home body. Keep Recent as the primary Home content. Decide on the Starred pseudo-tile: since Starred is reachable in the sidebar, remove it from the body too (do not orphan a lone tile). Remove now-dead CSS. Do not touch the sidebar folder tree.
ACCEPTANCE: Home body shows Recent (and search/action bar) but no folder tiles.

### 3B. Recent: add a view-mode toggle (reuse list/column/grid) and drop the separator line
OWNER: "for the recent items on home, have a toggle between the different kinds of view (lists or cards or other). Reuse the definitions we have. No separator line below Recent."
CURRENT: Recent is `.workspace-recent` (~:2765-2809) with an `<h2>Recent</h2>` + sort `<select>` header (~:2766-2780) and `.workspace-recent-list` (~:2789-2807); the separator lives on `.workspace-recent > header` border (broadsheet.css ~:3563). The reusable view-mode primitive is `FolderViewMode = "list"|"column"|"grid"` + `useFolderViewMode(id, defaultMode)` (`FolderPage.tsx` ~:59, ~:86-115; labels ~:268-272) and its Apple-HIG icon switcher (see 3C).
FIX: (a) add the SAME view-mode switcher used on folder pages to the Recent header (persist via `useFolderViewMode("recent", "list")` or an equivalent key) and render the Recent list in the chosen mode (list rows / one-column cards / grid) - reuse the existing row/card renderers so it is not a new layout. (b) remove the border-bottom separator under the Recent header (broadsheet.css ~:3563).
ACCEPTANCE: Recent has a small icon view toggle (list/column/grid) matching folders; switching modes re-renders Recent; no separator line under the header.

### 3C. Action bar follows Apple HIG; the bookmarks view switcher shows ICONS, not a "List ▾" text dropdown
OWNER: "the actions on the action bar do not follow Apple design guidelines; fix it. In Bookmarks it says 'list' with a little dropdown - that's the wrong representation. Show the various icons for them."
CURRENT: `FolderActionBar` (`FolderPage.tsx` ~:274; markup `.folder-top-action-bar` > `.folder-action-toolbar` ~:346). The view switcher is a `.ac-btn ac-btn-gray` rendering a TEXT label `{FOLDER_VIEW_LABELS[viewMode]}` + `▾` (~:358-371) opening a `.folder-action-menu` radio dropdown (~:372-400). Other buttons: Search (~:348), Share (~:349-357), Edit (~:401-405), More (~:406+). CSS broadsheet.css ~:3080/3087/3105/3150/3156-3194.
FIX: replace the text-label-plus-caret view switcher with an Apple-style SEGMENTED ICON control: three small icon buttons (list rows / one-column / grid) in a segmented group, the active one highlighted (`aria-pressed`), each with a `ShortcutTooltip` naming the mode. No dropdown. Then do a general HIG pass on the whole bar: consistent icon-button sizing, spacing, hit targets, hover/active states, light+dark; treat it like a native toolbar (compact icon buttons with tooltips) rather than a row of gray text pills. Keep every action's function identical; keep the `.ac-btn`/`.ac-icon-btn` class names or refactor cleanly if it reads better, but do not regress behavior.
ACCEPTANCE: in Bookmarks (and every folder) the view control is a segmented icon switcher, not "List ▾"; the action bar reads as a native Apple toolbar in both themes.

### 3D. Folder title: pen-on-hover to rename; move "Rename" into the 3-dot menu; drop the "Edit" button
OWNER: "In the folder, Edit doesn't make sense because it's only for renaming. Have a pen icon on hover of the folder name, and put the rename action in the 3-dot menu."
CURRENT: rename is triggered by the action-bar "Edit" button (`FolderPage.tsx` ~:401-405 -> dispatches `EDIT_FOLDER_TITLE_EVENT` ~:1308; `FolderTitleEditor` listens ~:502-512). Title header `.post-folder-page-header` / `FolderTitleEditor` (~:479, read mode `<h1 id="post-folder-page-title">` ~:533-539). `renameFolderAction` in `saveName` ~:520.
FIX: (a) remove the "Edit" button from `FolderActionBar`. (b) add a subtle pen icon that appears on HOVER of the folder title (`.post-folder-title-row`), clicking it enters the existing inline rename edit mode (dispatch the same `EDIT_FOLDER_TITLE_EVENT` or call the editor directly). (c) also add "Rename" to the folder's 3-dot `More` menu (`.folder-action-more` ~:406+). Keep the inline edit UI and `renameFolderAction` path unchanged.
ACCEPTANCE: no "Edit" button; hovering the folder title reveals a pen that starts rename; the `···` menu also has Rename.

### 3E. Home search is inline on the action-bar line; magnifier only appears when there's no room
OWNER: "on the home the search bar should be on the same line as the action bar. No need to show the magnifier icon; only show it if there is no room for the search bar - then clicking it brings up the little modal search bar we've got."
CURRENT: Home renders `WorkspaceSearchActionBar` (`.workspace-root-action-bar` > `.workspace-root-action-toolbar`, `PostWorkspaceShell.tsx` ~:2125-2136 / ~:2449) holding only the magnifier `WorkspaceSearchButton` (`src/components/workspace/WorkspaceSearchButton.tsx`), plus a separate inline `.workspace-search-field` block below (~:2453-2484). CSS broadsheet.css ~:3110/3116/3125/3341/3346.
FIX: on Home, put the actual inline search FIELD (`.workspace-search-field`: icon + `input[type=search]` + `/` kbd) directly ON the action-bar line (same row as any other home actions), filling available width. Remove the standalone magnifier button when the field is shown. Add responsive behavior: when the row is too narrow to fit the field, COLLAPSE to just the magnifier `WorkspaceSearchButton`, which on click opens the existing modal/inline search (the `/`-shortcut path). Use a container-width check (ResizeObserver or a CSS container query) rather than a hard breakpoint where practical.
ACCEPTANCE: on a normal-width Home the search field sits inline on the action bar with no separate magnifier; narrow the window and it collapses to a magnifier that opens the search.

---

## GROUP 4 - Item rows, selection, calendar

### 4A. Move the star to the LEFT of Recent/list items, outside the item box (Gmail-style)
OWNER: "on the items on recent, the star is on the right. It should be on the left, like Gmail. Put it outside the area where the item is, a little to the left of the actual item."
CURRENT: the star `.workspace-item-star` (`src/components/workspace/WorkspaceItemActions.tsx` ~:215-224) is part of the trailing `.workspace-item-actions` cluster (pin ~:210-214, star, `···` ~:225-238), placed AFTER the row content (e.g. `WorkspacePostOption` ~:2221-2228). CSS broadsheet.css ~:4004/4037/4099/4103.
FIX: move the star out of the trailing actions cluster to a LEADING position, rendered OUTSIDE the item's clickable box, in a small left gutter just left of the item (Gmail inbox style). It stays a toggle (`toggleStar` ~:99-126). Keep pin + `···` on the right. Ensure the left gutter reserves space so rows align whether or not an item is starred, and the star does not overlap the sidebar or shift text. Apply to Recent rows and folder list rows (the shared item-row renderer). At rest show the star subtly (outline) and filled/gold when starred (`.workspace-item-star` active color ~:4103).
ACCEPTANCE: the star sits in a left gutter outside each item row; toggling works; rows stay aligned; pin/`···` remain on the right.

### 4B. Marquee drag must not select text; lighten the selected-item outline to Apple weight
OWNER: "when I drag and select with the selection rectangle, it highlights the text of the selection. It should not. Also the stroke around the selected items is too strong; follow Apple guidelines."
CURRENT: marquee is drawn inline by `beginBackgroundSelection` (`PostWorkspaceShell.tsx` ~:6461-6544, pointerdown ~:6643), rectangle math in `src/lib/workspace-selection.ts` (~:105-138), marquee element `.workspace-selection-marquee` (~:6650-6661; CSS broadsheet.css ~:4212-4218). No `user-select:none` is applied during drag. Selected items get `.is-command-selected` with `2px solid` outlines: `.workspace-item-option.is-command-selected` (broadsheet.css ~:3434-3439), card `.post-folder-card-option.is-command-selected` (~:3809-3812), row `.post-folder-row-shell.is-command-selected` (~:3929-3932), shared group (~:4257-4269).
FIX: (a) while a marquee drag is active, add a class (e.g. `is-marquee-dragging`) to the workspace root and set `user-select: none` (and `-webkit-user-select: none`) on the content region so text is not selected; remove it on pointerup. (b) lighten the selected-item outline to an Apple-style weight: prefer a subtle accent RING/fill over a heavy 2px border - e.g. a 1px accent border plus a low-alpha accent background fill, or `box-shadow: 0 0 0 1.5px accent`. Apply consistently to all four selected-state rules above, checked in light AND dark against the 60% ink floor.
ACCEPTANCE: dragging a marquee selects items without highlighting any text; the selected outline is a refined Apple-weight ring, not a heavy border, in both themes.

### 4C. Multi-select bottom toolbar: add shortcut tooltips
OWNER: "the actions that show when I multi-select at the bottom need tooltips that show the keyboard shortcut for them."
CURRENT: `WorkspaceSelectionToolbar` (`PostWorkspaceShell.tsx` ~:3130-3210, shown when >=2 selected, mounted ~:6662) has Move/Share/Star/Trash buttons (~:3181-3208) with NO tooltips. Reusable: `src/components/keyboard/ShortcutTooltip.tsx`; labels via `shortcutLabelForCommand(id)` (`workspace.ts` ~:607-610). Toolbar CSS broadsheet.css ~:4171-4211.
FIX: wrap each toolbar button in `ShortcutTooltip` showing the action name + its keyboard shortcut (pull the shortcut via `shortcutLabelForCommand` for the matching command id; if an action lacks a binding, either add a sensible one or show the label without a key). Match the tooltip style already used on the action-bar buttons.
ACCEPTANCE: hovering each multi-select action shows a tooltip with its name and shortcut.

### 4D. Calendar: never render a trailing empty week
BUG (owner): "in the calendar there's an extra empty line after the week with the 31st, for no reason. Never more than the week starting with the 1st or ending with the 31st."
ROOT CAUSE: `SidebarActivity` `calendarDays` useMemo (`PostWorkspaceShell.tsx` ~:1013-1023) hard-codes a 42-cell / 6-week grid: `Array.from({ length: 42 }, ...)` (~:1018), starting Monday of the week containing the 1st. Months that fit in 5 weeks still render a fully-outside 6th week. Grid render ~:1067-1091; CSS broadsheet.css ~:2735-2822.
FIX: compute the number of weeks from the LAST day of the month instead of hard-coding 42: `weeks = ceil((leadingOffset + daysInMonth) / 7)`, cell count = `weeks * 7`. This yields 4, 5, or 6 weeks as appropriate and drops the trailing all-outside week. Keep the `is-outside`/`has-documents`/`is-today` classes and the Monday-start. Verify a 5-week month (e.g. a 30-day month starting mid-week) and a true 6-week month both render correctly.
ACCEPTANCE: no trailing empty week; months render exactly the weeks that contain their days.

---

## GROUP 5 - Right (assistant) sidebar

### 5A. Right sidebar open + pinned by default (fix the stale persisted state)
OWNER: "the right sidebar got unpinned. It must be open by default and pinned."
CURRENT: `AssistantSidebar` (`src/components/workspace/assistant/AssistantSidebar.tsx`, state `"hidden"|"open"|"pinned"` ~:24), mounted `PostWorkspaceShell.tsx` ~:6670. The CODE default is ALREADY `"pinned"` (`readAssistantState` ~:688-699; SSR ~:690; fallback ~:694-697). The owner is seeing a PERSISTED `"open"`/`"hidden"` in localStorage (`write:workspace-assistant-state`, key const ~:305) overriding the default - there is no reset/migration.
FIX: add a ONE-TIME migration that re-pins: bump a small version marker (e.g. `write:workspace-assistant-state:v2`) and, when the old marker is absent, overwrite `write:workspace-assistant-state` to `"pinned"` (or clear it so the default applies). Do NOT wipe unrelated keys. Keep the user able to unpin afterward (the migration runs once). Confirm the pinned layout still adds `has-assistant-pinned` (~:6605-6606).
ACCEPTANCE: on next load the right sidebar is open + pinned even for an install that had it hidden/open; the user can still change it and the choice persists (migration does not re-fire).

### 5B. Edge-proximity reveal on BOTH sidebars (consistent peek behavior)
OWNER: "when I come close to the edge of the right side, it appears - same behavior as the left."
IMPORTANT NUANCE (grounding): there is currently NO true mouse-near-edge proximity detector on EITHER side. The LEFT, when collapsed, shows a persistent click affordance `workspace-sidebar-reveal-chrome` / `SidebarToggleControl` (`PostWorkspaceShell.tsx` ~:1940-1949; CSS broadsheet.css ~:2855) - not a hover peek. The RIGHT has a `peeking` pointer-enter overlay but ONLY while `state==="hidden"` (`AssistantSidebar.tsx` ~:224-243, ~:319-332, ~:453-454). (`src/lib/workspace-hover.ts` / `workspaceMouseMoved` is a PREFETCH tracker, not an edge detector - do not repurpose it.)
FIX: implement ONE genuine edge-proximity reveal shared by both sidebars: when the pointer comes within ~24px of the left (or right) window edge and that sidebar is collapsed/hidden, peek it in as an overlay; if the pointer leaves without engaging, retract; if focus/click lands inside, promote to the persistent open/pinned state. Make left and right behave identically. Respect the pinned state (a pinned sidebar is already shown; peek applies to the collapsed/hidden state). Keep it smooth (0.18s motion) and do not trigger during a marquee drag or text selection.
ACCEPTANCE: with either sidebar collapsed, moving the cursor to that screen edge peeks it in; leaving retracts it; engaging keeps it. Left and right feel the same.

---

## GROUP 6 - Mac menu bar (EXTEND the in-progress quick capture; do NOT duplicate it)
NOTE: an in-flight feature pass already added Mac quick capture. Do NOT re-create it. Existing (may be uncommitted): `mac/Sources/Write/GlobalHotKey.swift` (Carbon `RegisterEventHotKey`, default ⌘⇧Space, no Accessibility permission), `QuickCaptureController.swift` (floating HUD `NSPanel`, ⌘↩ save / Esc dismiss), `QuickCapture.swift` (parse + durable `QuickCaptureOutbox` -> Notes folder via `ServerClient.postFile(..., representation:.textpack, idempotencyKey:)`). Wiring in `AppDelegate.swift`: `configureQuickCapture()` (~:516-534, called ~:141), `quickCaptureAction`/`presentQuickCapture` (~:536-553), status menu already has "New note" -> `quickCaptureAction` (~:2057). Canonical note-create path: `newNoteAction` (~:2129) -> `importExternalNote` (~:286) -> `createSyncedNote` (~:295-361) -> `postFile`. Status menu built in `menuNeedsUpdate` (~:2024-2079) with helper `item(_:_:)` (~:2081-2085). Window shown via `showMainWindowAction` (~:2176) -> `showMainWindow` (~:2208-2223) -> `WebAppWindowController.present()` (`WebAppWindowController.swift` ~:233-238); there is NO hide/toggle today. The app never READS `NSPasteboard` today (only writes it).

### 6A. Menu-bar shortcut to quickly create a note/bookmark
OWNER: "clearly have in the menu bar a shortcut to quickly create an item like a note or a bookmark."
FIX: "New note" already exists (⌘⇧Space + menu item). ADD a keyEquivalent to the status-menu "New note" item so the menu shows its shortcut, and ADD a sibling "New bookmark" quick-create. For the bookmark path, the current filer only handles the Notes folder; add a minimal bookmark quick-create that files into the Bookmarks folder via the same `importExternalNote`/`postFile` primitive (resolve the `mode=="bookmarks"` folder id the same way `createSyncedNote` resolves `mode=="notes"`; keep it unlisted-safe and durable through the outbox). If a full bookmark capture UI is out of scope, at minimum wire "New bookmark" to open a blank bookmark item; do not leave it broken.
ACCEPTANCE: the status menu shows "New note" and "New bookmark" with visible shortcuts; both create the right item type via the sync API into the correct folder.

### 6B. Global shortcut to toggle the app window in/out of view
OWNER: "or bring up the app, like quickly toggle it in view or not. I need a shortcut."
FIX: add `toggleMainWindowAction` beside `showMainWindowAction` (~:2176) that checks `webWindow?.window?.isVisible` and branches: visible -> `orderOut(nil)` (add a `hide()`/`orderOut` method to `WebAppWindowController`), hidden/nil -> `present()`. Register a SECOND global hotkey via the existing `GlobalHotKey` infra (suggest ⌘⇧W or ⌘⇧Return; pick one that does not collide with quick capture ⌘⇧Space) bound to `toggleMainWindowAction`. Add a status-menu item near "Open Texttext" (~:2055) reflecting the toggle, with its keyEquivalent shown. Retain/unregister the ref in the same places as the capture hotkey.
ACCEPTANCE: the shortcut shows the app window if hidden and hides it if visible; the menu item shows the shortcut.

### 6D. Harden the quick-capture outbox (3 LOW findings from an adversarial review of the just-landed feature)
While you are in this Mac quick-capture code, fix these three durability issues found by review (all LOW, none block, but fix them properly since you are here):
- 409/permanent-error INFINITE RETRY LOOP: `mac/Sources/Write/QuickCapture.swift` `QuickCaptureFiler.file` (~:225-249) maps a `postFile` `.failure` to `.retry`, and `ServerClient.postFile(representation:)` (`ServerClient.swift` ~:269-278) maps EVERY non-201/non-400 status to `.failure`. So a 409 (or any permanent 4xx) makes the drainer retry every 15s forever. Make the outbox wedge-proof: add a bounded attempt count to `QuickCaptureRecord` (Codable, default 0 for old records), increment it on each `.retry` in `QuickCaptureOutboxDrainer.drain`, and after a small threshold (e.g. 5) move the record to the dead-letter/rejected dir with a clear message instead of retrying forever. Prefer this general bounded-retry-then-dead-letter fix over special-casing 409 in the shared `postFile` (do NOT change `postFile` status mapping for the other callers newNoteAction/importExternalNote/createSyncedNote). A transient 5xx/network error should still retry; only repeated failures dead-letter. Keep the note recoverable (dead-letter dir, not deletion).
- `enqueue` PERMISSION ORDERING (`QuickCapture.swift` ~:114-125): the record is written atomically THEN `setAttributes([.posixPermissions: 0o600])` runs; if `setAttributes` throws, `enqueue` throws `couldNotPersist` even though the bytes are already durably on disk (so the caller thinks the capture was lost when it was not). Fix so a `setAttributes` failure does not report the capture as un-persisted (e.g. best-effort chmod after a successful write, or set permissions via the write itself); the durability guarantee is "bytes on disk", not "chmod succeeded".
- STALE CACHED NOTES-FOLDER ID (`AppDelegate.swift` ~:585-597 `drainQuickCaptureOutbox` + `ServerClient.swift` ~:272): the drain prefers `store.cachedWorkspace()` and only fetches fresh on a cache MISS. If the cached workspace's notes-folder id is stale/wrong, every drain files with a bad `?folder=` id. On a drain that fails to resolve/file into the notes folder, fetch a FRESH workspace once and retry before giving up, so a stale cache cannot silently misfile or wedge captures.
ACCEPTANCE: a permanently-failing capture dead-letters after a bounded number of attempts (no infinite loop); a chmod failure does not report a persisted capture as lost; a stale cached notes-folder id triggers one fresh workspace fetch. Add/adjust Swift tests for the bounded-retry dead-letter path.

### 6C. Shortcut to paste the clipboard into a NEW item
OWNER: "I need a shortcut so I can quickly paste what's in my clipboard into a new item."
FIX: add `captureClipboardAction` that reads `NSPasteboard.general.string(forType: .string)` (net-new read; the app has none today), and if non-empty routes it through the DURABLE path: `QuickCaptureContent.parse(text)` (first line = title) -> `outbox.enqueue(...)` + `retryQuickCaptureDrain()` (so it is offline-safe like quick capture), filing into the Notes folder. If the clipboard is empty, no-op (optionally beep). Add a status-menu item "New note from clipboard" with a keyEquivalent, and register a global hotkey for it via `GlobalHotKey` (suggest ⌘⇧V; ensure no collision). Do NOT route through the bookmark SCREENSHOT capture agent.
ACCEPTANCE: copy text anywhere, press the shortcut -> a new note is created (durably) with that text, first line as title; empty clipboard is a safe no-op.

---

## Verify (leave the tree GREEN)
- Web: `npx tsc --noEmit`, `npm test`, `npm run build` all pass.
- Mac (Group 6): `cd mac && swift build && swift test` pass.
- The app is plain DOM; do NOT run a dev server (sandbox cannot bind ports). Reason carefully about focus/selection/keyboard changes since they cannot be clicked here; keep behavior deterministic and covered by unit tests where practical (calendar week count, up-navigation origin, numbered-index resolution, tag/selection helpers).
- Add/adjust tests your changes invalidate rather than deleting them. Suggested new unit tests: calendar `weeks` computation (4/5/6-week months), `workspaceHierarchyUpTarget` with `openedFrom:"root"`, the Cmd+index -> nav-target mapping, the `activeRegion` gating (arrow in sidebar does not mutate body selection), marquee `is-marquee-dragging` toggling user-select.

## Working rules
- The sandbox mounts `.git` READ-ONLY, so `git commit` may fail (index.lock EPERM). LEAVE everything in the working tree; that is expected. Do NOT push, do NOT run release scripts, do NOT bump versions or edit `mac/Info.plist` / `src/generated/app-release.ts`.
- Re-grep every named symbol before editing; `PostWorkspaceShell.tsx` line anchors above may have drifted.
- Keep changes scoped to the owner workspace chrome + the Mac menu bar. Do not refactor unrelated systems.

## Output
End with a concise per-group report: what changed (file:line), how the `activeRegion` model works, the final keyboard map (plain digits vs Cmd+digit, E, Backspace), the calendar fix, the right-sidebar migration key, and the three new Mac menu actions + their hotkeys. Note anything deliberately deferred (e.g. bookmark quick-create depth).
