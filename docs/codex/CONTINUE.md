# Write: Codex continuation (2026-07-18, batch 4 completed)

## Current status

Batch 4 is implemented and verified. Items A through H below are retained as the
historical acceptance criteria, not as pending work.

- Native Foundation Models sessions prewarm and retry bounded asset preparation.
- Reader text selection no longer starts the workspace marquee.
- Selected reader text can create anchored comments, and threads render inline.
- Bookmark recapture, source captions, and Reader or Full controls use the agreed chrome.
- Root, folder, and item views share one responsive search control, including item highlights.
- Web verification passed: TypeScript, 565 tests, and the production Next build.
- Mac verification passed: Swift build and 366 tests.

The next durable release is `0.99`. The prior local `0.98` install was ahead of the
public `0.97` feed, so `0.98` must not be reused as an immutable release identifier.

You (Codex, gpt-5.6-sol, high + priority) are continuing an autonomous build effort on
Write. Read AGENTS.md, CLAUDE.md, DESIGN.md, and docs/codex/HANDOFF.md first. Work on
`main` in ~/dev/write. NO em dashes anywhere. The sandbox mounts .git READ-ONLY so you
cannot commit; leave changes in the working tree (or your worktree) and the launchd
integrator commits + the autobuild daemon (net.writeapp.write.autobuild) ships. One
writer on the main tree at a time; if a ship is grinding, work in a git worktree so you
do not add load to the machine during its test phase (concurrent load causes test flakes).

## Release state (as of handoff)
- Last clean public release before this batch: 0.97 (write.ramine.net serves 0.97/103).
- The installed 0.98 build was produced by an interrupted earlier ship and is not public.
- Ship this completed batch as 0.99. The build number remains monotonic through
  `max(source, installed) + 1` in `mac/scripts/release.sh`.

## Completed acceptance criteria: batch 4

### A. On-device model actually usable (the top user complaint)
The Assistant errors "could not access a required local resource" because FoundationModels
throws GenerationError.assetsUnavailable / "Local Model Asset unavailable" at generation
time even though availability reports .available: the model asset is not downloaded/ready,
and nothing prewarms it.
- mac/Sources/Write/NativeAI.swift: `capabilities()` ~147-187; `respond(instructions:prompt:)`
  / `languageOp`; `agentOp` ~1572+; error mapping `agentSessionErrorMessage` ~213-261 and
  `unavailableModelMessage` ~189-211; the friendly strings at :234 and :243. There is NO
  `prewarm` anywhere today.
- FIX: prewarm the on-device model to trigger the asset download at a sensible point (app
  launch after the move-to-Applications guard, and/or when the assistant sidebar opens);
  keep a reference so it warms once. On `assetsUnavailable`, do NOT dead-end: treat it as
  "the on-device model is still preparing" with a bounded retry/backoff (re-attempt after a
  short delay a few times) and clear actionable copy; if genuinely unavailable
  (deviceNotEligible / appleIntelligenceNotEnabled), point the user to enable Apple
  Intelligence in System Settings. Web side: src/components/workspace/assistant/
  useNativeAssistant.ts (catch ~513-532) routes asset errors through
  `fallbackForNativeAssetError` -> `runUnavailableAssistantFallback`
  (src/components/workspace/assistant/unavailable-fallback.ts ~39-104): today it reprobes ONCE
  and, with no cloud key, returns a static dead-end message - NO retry/backoff. Replace that
  single dead-end with a bounded retry/backoff that re-probes `nativeAICapabilities` and
  re-invokes the native op a few times with increasing delay, showing a "model still
  downloading" state (copy already exists for `modelNotReady` ~28-29). Prewarm hook on the web:
  after the availability probe at useNativeAssistant.ts ~338. Sessions are created per-request
  (NativeAI.swift `respond` ~281, `agentOp` ~1614) and never cached - warm once at first
  `capabilities` success or app launch. Make the Swift `assetsUnavailable` branches (~231-234,
  ~242-243) signal a distinct "preparing/downloading" state, not a flat "Try again", so the web
  layer can drive the retry. Keep the existing graceful cloud fallback (fires only with a key).
- Verify with `cd mac && swift build && swift test`.

### B. Reader text-selection regression (web)
Click-drag over blog/note/bookmark BODY text triggers the workspace selection RECTANGLE
(marquee) instead of normal text selection.
- Root cause: PostWorkspaceShell.tsx ~6982-6991 - `.post-editor-content` `onPointerDown`
  calls `beginBackgroundSelection` (~6770-6855), and the reader renders INSIDE that div. Its
  `insideInteractive` guard (~6773-6779) excludes inputs/links/contenteditable but NOT the
  reader prose. `shouldClearWorkspaceSelection` is workspace-navigation.ts ~126-136. The
  amplifier is broadsheet.css ~4351-4355 (`user-select:none` on `.post-editor-content *`
  during `is-marquee-dragging`); marquee box CSS ~4065-4071.
- Reader prose: Reader.tsx ~159-210 (`.reader-prose` inside `article.reader`); also
  ProjectReader.tsx / TalkReader.tsx.
- FIX: exclude the reader/prose region (and any static prose) from the marquee - add a
  `.reader`/`.reader-prose` (or "drag began inside prose text") exclusion to
  `insideInteractive` and narrow the `is-marquee-dragging` `user-select:none` so it never
  covers reader prose. Result: dragging in a post selects TEXT normally.

### C. Comment on the selected text (web)
When text is selected in an item, offer a "Comment" affordance; the backend already supports
anchored comments end to end, the UI just never uses it.
- ItemCommentAnchor = { field:"title"|"excerpt"|"body"; exactQuote; start?; end? } at
  store.ts ~183-189; comments carry `anchor` (store.ts ~204). `addItemCommentAction` already
  accepts anchor args at src/app/editor/actions.ts ~967-1021. But CommentsDialog.tsx ~287
  calls it with body only and hardcodes anchor:null (~279, ~317).
- FIX: add a selection menu (in the reader `.reader-prose`, and/or reuse the Tiptap BubbleMenu
  in BodyEditor.tsx ~559-575) with a "Comment" button that calls `addItemCommentAction` with
  field:"body", exactQuote:<selected text>, and offsets. Pair with B (native text selection
  must work first).

### D. Comments = inline icon, not a right-side bar (web)
- The big right-side sheet is CommentsDialog.tsx (panel + backdrop in
  CommentsDialog.module.css `.backdrop`/`.panel`). Its trigger is `.post-comments-button` at
  PostActionBar.tsx ~990-1019, rendered ~1184, with `.post-comments-count` badge.
- FIX: REMOVE the Comments button from the action bar entirely (~1184 + its definition), and
  show comments as a compact Notion-style inline icon/indicator in the reader prose keyed off
  each comment's `anchor`; clicking the icon opens that comment thread (reuse the existing
  `commentsOpen`/`openCommentCount` state and CommentsDialog data, not the 410px sheet).

### E. Bookmarks: move Recapture into the "..." menu, edit mode only (web)
- `BookmarkRecaptureControl` PostActionBar.tsx ~384-479; instantiated as `recaptureControl`
  ~1020-1027, rendered in the toolbar ~1186 (shows in read+edit today). The "..." menu is
  `.post-edit-menu` ~1249-1282 (only renders when `canManagePost && mode==="edit"`).
- FIX: remove Recapture from the toolbar row; add it as a `.post-edit-menu-item` inside the
  "..." menu, edit mode only.

### F. Bookmarks: remove the top "Original" link, add a caption under the title (web)
- Top button `.post-bookmark-original-button` PostActionBar.tsx ~964-986; url computed
  `bookmarkOriginalUrl` ~927-931 (`post.capture?.url` || first link href).
- Reader title Reader.tsx ~150-154 (`.reader-title` in `.reader-masthead` ~144-158).
- FIX: delete the top Original button; render a caption "originally captured from: <URL>"
  directly under the bookmark `<h1>` in the masthead (link the URL).

### G. Bookmarks: replace "Show full capture" with a "View as: Reader | Full" toggle (web)
- Button `.post-bookmark-view-button` PostActionBar.tsx ~943-963 (label "Show full capture");
  state `bookmarkMode` ~925-926, `BookmarkContentMode = "readable"|"capture"|"original"` (~80);
  state owner PostWorkspaceShell.tsx ~3517-3530; body switch `BookmarkViewBody` ~3429-3483.
- FIX: replace the single toggle with a two-button segmented control "View as: Reader | Full"
  (Reader = "readable", Full = "capture"), active state highlighted.

### H. Search always in the action bar + find-in-page (web)
Whether viewing a FOLDER or an ITEM, the search control sits in the action bar at the SAME
position. If there is room, show the full inline search FIELD (focus with "/"); if not, show
only the magnifier icon that opens the modal search. When inside an ITEM, typing HIGHLIGHTS
matching text within the item (find-in-page), not navigate away.
- The inline-FIELD + ResizeObserver collapse-to-magnifier model exists ONLY on the root bar
  today: `WorkspaceRootSearchActionBar` PostWorkspaceShell.tsx ~2288-2343 (compact when
  width<360, "/" focus via focusRequestKey ~2313-2317), with the field `.workspace-search-field`
  ~2636-2665. The FOLDER bar (FolderPage.tsx ~305, `WorkspaceSearchButton` only) and the ITEM
  bar (PostActionBar.tsx ~1173-1176, `onSearch` only) are magnifier-only. FIX: extract that
  root inline-field+collapse component and mount it in the folder bar and the item bar at the
  same slot, so search sits identically in all three.
- The shared handler `focusSearch` (PostWorkspaceShell.tsx ~5133) currently FORCES navigation
  to root before focusing (~5138-5144). Branch it: when `viewRef.current.level` is
  `post`/`edit`, do NOT navigate to root - drive an in-item find-in-page highlighter instead.
- Find-in-item highlight is NET-NEW (Reader.tsx ~161-208 just renders ReactMarkdown; no
  highlighter, no <mark>, nothing in workspace-search.ts for in-item). Add an in-item
  highlighter that marks + scrolls to matches in the reader prose as you type, scoped to the
  open item. Keep folder/list search behavior unchanged.

## Verify each unit
- Web: `npx tsc --noEmit`, `npm test`, `npm run build` all green.
- Mac (A): `cd mac && swift build && swift test`.
- Do NOT run a dev server (sandbox cannot bind ports; exit 144 after finishing is fine).
- Add/adjust tests for what you change. Leave the tree green. Do NOT bump versions, edit
  mac/Info.plist or src/generated/app-release.ts, push, or run release scripts - the
  integrator + daemon own shipping.

## Changelog
Every user-facing unit gets a newest-on-top entry in the "Write Changelog" NOTE (a .textpack
in the owner's workspace; see AGENTS.md "Changelog"). You cannot reach the mount from the
sandbox - put your user-facing entry in your final report and the integrator prepends it.

## Output
End with a per-item report: what changed (file:line), how you verified, and any item
deliberately deferred.
