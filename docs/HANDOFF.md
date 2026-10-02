# TextText handoff

## Current work

Blog drafts now use the full workspace width while writing, with the folder sidebar hidden and a Back to Blog action that flushes the draft before navigation. The reader and other folders keep their shell. Disabled Publish colors are readable in light and dark. The local browser flow passed across draft creation, editor formatting, navigation, and the remaining surfaces; TypeScript and web vault browser checks passed. `/tmp/texttext-new-story-editor-light-reference.png` and `/tmp/texttext-new-story-editor-dark-reference.png` show the updated draft. Medium editing parity remains open; no app release was run.

Command K now ranks the current item or folder actions before generic creation commands and shows a matched everyday alias, such as `Save bookmark (Read later)`. Its icon, shortcut, centered layout, dismissal, and folder/file search behavior remain. Local and web browser flows, focused search tests, and TypeScript passed. This follows Superhuman's published command-palette guidance; a side-by-side visual review in the signed-in product is still needed. No app release was run.

Web vault editing and creation now pass the browser flow again. The browser fixture follows the current Notes navigation and exercises the real vault collaboration codec. A newly created Note exposed an empty-subtitle mismatch between saved snapshots and Yjs projections; `src/lib/vault/collaboration.ts` now compares those equivalent values consistently. `node src/local-vault/__tests__/verify-web-browser.mjs`, 60 targeted collaboration/transport tests, and `npx tsc --noEmit` passed. Reference parity across Bookmarks, Gallery, Feeds, Blog, Notes, and Command K remains open; no app release was run.

Gallery image detail now edits title and source beside the image, in addition to caption and tags. Source changes synchronize the TextPack's legacy `links` projection with `sourceUrl`, so reopening the image shows the new link instead of an older one. The full Gallery editor uses the same source-field update. TypeScript and the local browser flow passed, including reopen; `/tmp/texttext-gallery-inline-inspector-light-reference.png` is the checked light screenshot. No app release was run.

Blog's draft header now keeps Publish and Done prominent while putting Share and Comments in More (they remain in Command K). Routine save labels no longer crowd the local toolbar; error/offline/unconfirmed states remain visible. TypeScript and the local browser flow passed; the checked light screenshot is `/tmp/texttext-new-story-editor-light-reference.png`. No app release was run.

Notes quick creation now starts in the card body whether invoked by the top New note button, the grid's Start typing card, or a first printable key while browsing Notes. The keyboard path seeds that first character in the Note TextPack before opening the editor, so it is not lost. The title remains editable. TypeScript and the local browser contract passed; no app release was run.

The Bookmarks reader now has an inline personal note above the saved article. Add, edit, and save write `texttextBookmarkNote` into the Bookmark TextPack with the existing revision-aware vault write; article body and tags stay separate. TypeScript and the browser contract passed, including saved field assertion; `/tmp/texttext-bookmark-note-reference.png` is the dark screenshot. No app release was run.

Feeds now leads For You and Latest with the first available story image, then uses a five-row rhythm for later large images. Cross-publisher source names stay compact with the full list in the hover title. TypeScript and the local browser contract passed; visual checks are `/tmp/texttext-feeds-ranked-reference.png` and `/tmp/texttext-feeds-latest-reference.png`. Artifact parity is still open, and no app release was run.

Blog's writing toolbar now labels its autosaved edit transition Done and moves Change look into the editor's More menu. The story title, subtitle, body, and Publish action remain visible. The local browser contract verifies the menu and title-to-subtitle keyboard path, and its light screenshot is `/tmp/texttext-new-story-editor-light-reference.png`. TypeScript and the full local browser flow passed; no app release was run.

Command K now offers the open item's Share, Comments, Publish, and Version history actions when the same permissions permit their visible controls; Share also works for the current folder. The browser contract opens Version history through the palette and checks contextual command visibility. `/tmp/texttext-command-item-actions-reference.png` shows the filtered Share action. A null-path guard fixes an intermittent Bookmarks reader crash during URL capture. TypeScript and two consecutive full local browser runs passed. No app release was run.

Gallery image detail now edits captions and tags in its right inspector while the image remains visible. These controls write the same Gallery TextPack used by the full editor. The local browser contract verifies save/remove behavior and passed; light and dark screenshots are `/tmp/texttext-gallery-inline-inspector-light-reference.png` and `/tmp/texttext-gallery-inline-inspector-reference.png`. No app release was run.

Dropping a web link into the Bookmarks folder now saves it directly as a Bookmark TextPack and selects it in the reader. It uses the same URL validation and enrichment path as Save bookmark. The local browser contract covers the drop and passed; no app release was run.

Existing Note TextPacks now open as finished cards, with Edit card or Enter switching to editing. Newly created notes still open ready for typing. The local browser contract covers both paths and passed; no app release was run.

Feeds now has a Read Later view sourced from saved Bookmarks TextPacks, including items older than the currently loaded feed pages. It opens the selected item in the Bookmarks reader. The native metadata scan returns bounded title, source, date, path, and stable hash; it does not fetch feeds or assets. The view keeps source pagination inside Sources and does not show source loading controls on Read Later. Restricted shared views do not request personal saved-story metadata. The focused Swift test and full local browser flow passed; `/tmp/texttext-feeds-read-later-reference.png` is the dark screenshot. Artifact reference parity, including persistent reading progress and feedback, remains open.

Overlapping local folder-list responses now apply only the newest request, so a stale listing cannot replace a post-save refresh. The browser contract waits for the Bookmarks view to mount before asserting its reader; two final runs passed.

Gallery previews now trim excess secondary thumbnails to fit the 512 KiB Mac bridge response while retaining the primary image. This prevents a large multi-image TextPack from turning into a text-only tile. The focused `LocalVaultAgentFilesTests/testOversizedGalleryPreviewKeepsPrimaryImageAndFittingTiles` passed. The browser gallery contract was not changed by this native fix; full reference parity remains open.

The October 2 work is the folder-based template redesign, committed through `8b15161f` before the current Bookmarks day-grouping update. Feeds has ranked For You, chronological Latest, grouped cross-publisher Headlines, an in-app reader, and Save to Bookmarks as bookmark TextPacks. Its source window now shows eight sources at a time with explicit loading of more subscriptions and an in-visit bounded cache. A bounded metadata index covers subscriptions across source-list pages, so the news view can load the 25th source and beyond. Notes has tags during card editing, a compact editor, and a Finish, saved card, Edit card cycle for local and shared notes. Command K is centered with action icons and shortcuts, second-press dismissal with focus restoration, forgiving action matching, and monospaced command text. Gallery has an image-first editor with title and caption controls plus a justified image grid that fills rows without cropping; image details now show colors and dimensions from the selected asset, including legacy files. New imports keep dimensions in their TextPack asset metadata. Newly saved bookmarks stay in the Bookmarks inbox reader with compact URL-first capture, Inbox and Archive states, and tag editing and filtering. Blog drafts show a subtitle during writing and align title, subtitle, and body on one measure. That subtitle now reaches Mac and web previews. Saved Blog stories open in a reader with Edit story; new drafts open ready to write, and Publish can return to topic editing. These are TextPack views and editors, not a second content model. Tasks are out of this pass. New local workspaces start with Blog, Bookmarks, Notes, Gallery, Feeds, and Presentations; the Templates folder stays internal. The current local workspace at `~/Documents/TextText` was refined in place; original packs are recoverable under `.texttext/starter-before-refinement-2026-10-02`.

Oracle remains the sole host and storage location. The last shipped release and production receipts are in [the September 30 archive](HANDOFF-history-2026-09-30.md).

The saved Note card now uses a corner pencil control and bottom-aligned tags, following the Supernotes card layout. Its text stays readable in both light and dark themes.

Command K now searches the live folder tree for `Go to…` actions. These destinations stay out of the initial action list, and selecting one flushes the open item before navigating. The local browser contract verifies the keyboard flow.

New from template now includes bundled Blog, Note, Bookmark, Gallery, and Presentation choices when a workspace lacks matching Templates files. Built-in choices keep the same TextPack creation paths as the folder actions.

The creation picker now gives those five choices distinct story, note card, saved-link, image-grid, and slide previews instead of identical skeletons. Light and dark picker screenshots are `/tmp/texttext-template-picker-reference.png`, `/tmp/texttext-template-picker-gallery-reference.png`, and `/tmp/texttext-template-picker-dark-reference.png`. Reference-level visual parity remains open.

Saved template cards now preview bounded title, excerpt, source, and tag data from their TextPack snapshots through the Mac template metadata endpoint. The picker calls them “Your templates” and does not expose the internal Templates path on hover. Bundled choices still use representative content; saved-template asset thumbnails are not loaded dynamically.

The bundled Gallery choice now shows the four actual photos from its starter TextPack rather than colored blocks. The local bundle copies those existing assets for offline display; the browser contract checks an image loads. Light and dark picker screenshots show the image-led choice.

The creation picker now offers Feeds when the workspace can read and create feed subscriptions. Its news preview leads into the existing URL-first Add source dialog, which writes the subscription as a TextPack in Feeds. The card is absent before connection or without permission; `/tmp/texttext-template-picker-feeds-reference.png` shows it in a connected local fixture.

Bookmark capture now accepts a bare web address such as `example.com/article`, stores the canonical `https://` URL in the Bookmarks TextPack, and still treats prose containing a domain as a note. The URL-first form no longer blocks a bare address through browser type validation.

A saved Note card now takes focus when its noninteractive content is clicked, and Enter opens its editor; the pencil remains available. The browser contract verifies the focus, Enter edit, Finish, and pencil edit cycle on the same TextPack.

The Notes editor now places its single Finish action in the card’s bottom-right footer instead of the page toolbar. Command-Enter still finishes. The local browser contract checks the button’s location and the shortcut; `/tmp/texttext-note-editor-reference.png` shows the current dark editor.

The Notes folder now starts with a Start typing card that opens the same Note TextPack creation path as New note and focuses the title. The browser contract clicks it and completes a tagged card; `/tmp/texttext-note-grid-reference.png` shows the folder state.

Command K now shows five full commands with the next partially visible, and arrow-key selection keeps the active command in view even when wrapping to the last row. The browser contract checks the active row remains within the scroll area; `/tmp/texttext-command-reference.png` shows the current palette.

Blog folder rows now project author, title, subtitle, opening excerpt, and a cover when available from the story TextPack. The subtitle no longer displaces the excerpt. The browser fixture verifies these distinct fields; `/tmp/texttext-blog-reference.png` shows the row.

Single-story rows in Feeds now have a Read later action. It fetches that full feed entry only when clicked and saves a bookmark TextPack in Bookmarks, using the same pack creation path as the reader action. The local browser contract verifies the new pack and saved state; `/tmp/texttext-feeds-latest-reference.png` shows the row action. A native metadata scan now reads only `document.json` from bookmark TextPacks to restore saved state after Feeds reopens; saving rechecks the stored feed identity before import. Swift, RSS, and browser checks cover this path. The read-before-import check is not atomic across separate app processes.

The Bookmarks reader now uses compact previous/next navigation, Reader and Original controls, a sans-serif title/body, and a source line below the title to track Shiori’s public dashboard example. Its items remain bookmark TextPacks, and URL-first capture remains the creation path.

The Gallery detail viewer now occupies the workspace beside the still-visible folder sidebar, with a large image, right inspector, zoom, and Fit. Folder navigation closes the viewer. A single Gallery import opens its image-first item editor for title and caption; batch imports return to the grid. This follows Resurf’s public image detail view while the assets remain inside the Gallery TextPack.

The Gallery inspector also edits source and tags on the same TextPack. The viewer shows those tags and opens valid web sources directly.

Feed source creation now starts with a website or feed address, shows discovered sources, and keeps folder/topic choices optional until after discovery. The dialog sizes to its contents. Selecting a source still saves a subscription TextPack in Feeds.

Feeds now has an Artifact-style search pill above its topic tabs. It filters stories already loaded from followed source TextPacks, including Headlines groups, without fetching or creating new files. Source-loading controls sit below the story list so the first screen leads with news. The original Artifact screenshots named in the old plan are absent from this checkout and the former Downloads paths; the plan's written visual measurements are the current reference.

An empty Feeds folder now opens a topic-led interest picker using the repo's 16-source starter catalogue. Continue writes subscription TextPacks in Feeds for the selected topics; the existing Add source flow remains available for a specific URL. The first feed read is still bounded to eight sources and only runs when Feeds opens.

The Blog reader now uses a bold sans-serif title, a long-form serif body, and reading time computed from TextPack content. New Blog drafts have an empty content title and a Title placeholder while retaining a safe TextPack filename. The reader remains a view of the article template, not a separate content type.

The Blog selection toolbar now offers link, heading, subheading, and quote actions alongside bold and italic, following Medium’s documented writing controls. They update the article TextPack Markdown body. The link entry validates web addresses, and its popover closes on outside click, scroll, or Escape.

Empty Blog drafts now show New story in the active header and Blog list while their content title remains blank and the TextPack filename stays safe.

The Notes edit card now keeps tags in a compact bottom row and reduces empty body height; its short-card shape remains under 300 pixels tall in the local browser fixture. The same note TextPack fields drive edit and saved-card views.

In the Notes folder, typing a printable character starts a card and retains that first character in the TextPack title. The established N shortcut now follows the same path there; Command K and focused text fields keep their own keyboard behavior.

New bookmarks record their save time in the initial TextPack snapshot. The Bookmarks inbox orders dated saves newest first and groups them by day; undated legacy files remain under Saved links. This follows Shiori’s dated inbox list.

## Verification

- October 2 checks: TypeScript, focused Vitest tests, Swift starter tests, and the rebuilt local browser contract in light and dark passed. Browser checks cover bookmark reading and capture, story and note creation, multi-image viewing, feed headlines, command navigation, save and recovery. The latest browser run verifies explicit eight-to-25 source loading across a source-list page boundary without duplicate feed reads, cleared import status on folder navigation, Blog title-to-subtitle-to-body focus and saved subtitle, URL capture into the Bookmarks reader, Gallery title/caption persistence, centered Command K, note tags, cross-publisher coverage, and the full-entry feed reader. The add-source browser flow checks URL-first discovery, optional topic selection, and the resulting subscription TextPack; screenshots are `/tmp/texttext-add-feed-source-reference.png` and `/tmp/texttext-feed-source-chooser-reference.png`. Screenshots are saved under `/tmp/texttext-*-reference.png` on this Mac.
- The Note Finish, saved card, Edit card cycle passes TypeScript, the local UI bundle build, and the full local browser contract. The contract also caught and verified a fix for captured links using the Note template: their Article reader takes precedence over the Note card. The saved card screenshots are `/tmp/texttext-note-card-reference.png` and `/tmp/texttext-note-card-light-reference.png`; the browser contract checks light-mode title and body contrast and the edit control.
- The bookmark Inbox, Archive, and tag controls pass TypeScript and the local browser contract. The bookmark screenshots are `/tmp/texttext-bookmark-reference.png` and `/tmp/texttext-bookmark-light-reference.png`. The browser contract checks previous/next navigation and light-mode text contrast.
- The Gallery justified grid passes TypeScript and a browser check for row fill, equal row height, uncropped image proportions, portrait/landscape widths, palette changes while navigating images, legacy dimensions in the viewer, and persisted dimensions on new PNG imports. Its grid screenshot is `/tmp/texttext-gallery-grid-reference.png`; detail screenshots are `/tmp/texttext-gallery-reference.png` and `/tmp/texttext-gallery-light-reference.png`. The browser contract also checks inspector size, zoom, and Fit.
- Blog subtitle previews pass the Mac and web preview tests, TypeScript, and the full local browser contract; `/tmp/texttext-blog-reference.png` shows the list result. The Blog reader/edit transition passes TypeScript, the local UI bundle build, and browser checks for opening a saved story, returning from Publish to edit topics, saving to the reader, and editing again. `/tmp/texttext-blog-reader-reference.png` shows the reader.
- The Blog typography and blank draft title pass TypeScript, the local UI build, and the full local browser contract. Reader screenshots are `/tmp/texttext-blog-reader-reference.png` and `/tmp/texttext-blog-reader-light-reference.png`; the new draft screenshot is `/tmp/texttext-new-story-editor-light-reference.png`.
- Blog selection formatting passes TypeScript, the local UI build, and the full local browser contract for bold, link, heading, and quote.
- The New story header passes the full local browser contract; `/tmp/texttext-new-story-editor-light-reference.png` shows the title placeholder and corrected header.
- The compact Notes editor passes TypeScript, the local UI build, and the browser layout check; screenshots are `/tmp/texttext-note-editor-reference.png` and `/tmp/texttext-note-editor-light-reference.png`.
- Bookmark day grouping and initial saved timestamp pass TypeScript, the local UI build, the full browser contract, and the targeted Swift bookmark-capture test. `/tmp/texttext-bookmark-light-reference.png` shows Today and legacy Saved links groups.
- The integrated Gallery viewer passes TypeScript, the local UI build, and the full browser contract. The browser verifies a visible folder sidebar, image navigation and zoom, and closing on folder navigation; `/tmp/texttext-gallery-light-reference.png` shows the updated light-theme view.
- Single-image Gallery import now opens its TextPack editor. The browser contract verifies the imported title, caption save, and persisted image dimensions; drop and paste creation reach the editor too. Multi-image imports still leave the collection grid visible.
- Gallery source and tags pass TypeScript, the article-capture unit test, and the local browser contract. The browser confirms they persist and appear in the image viewer, and that a Gallery source does not activate article capture controls. `/tmp/texttext-gallery-editor-light-reference.png` shows the updated inspector.
- Feed search passes TypeScript, the local UI bundle, and the full browser contract for matching stories and an empty result. `/tmp/texttext-feeds-ranked-reference.png` shows the search pill, topic tabs, and first stories in dark mode.
- Feed onboarding passes TypeScript, the local UI bundle, and the full browser contract for selecting two topics, creating eight subscription TextPacks, and landing on the feed. `/tmp/texttext-feeds-starter-reference.png` shows the interest picker before selection.
- Notes type-to-create passes TypeScript, the local UI bundle, and the full browser contract for retaining the first character, continuing title input, and persisting the resulting note TextPack after Finish.

## Boundaries

- The installed app remains 0.203 build 1151. The rebuilt UI bundle under `mac/build/LocalVault` is test-only and has not been installed or published. Visual parity with the named products has not been established by a side-by-side review on real content. Command K's current shape follows Superhuman's published design guide, not a verified pixel match. Feeds has deterministic ranking over followed sources, but has no durable personal interest/read feedback yet; its reader and coverage page have been checked only with local fixtures. Blog typography and draft creation were compared with a public Medium story and its writing guidance, but its complete editing experience still needs comparison on real content. Artifact's original 28 screenshots described in [the historical plan](plans/artifact-home-replication.md) are not present in this checkout or their former Downloads paths.

## References

- [Content checkpoint](TEXTTEXT_UX_CHECKPOINT.md)
- [File-vault architecture](design/texttext-file-vault-migration.md)
- [Oracle operations](../release/oracle/README.md)
- [Resolved release history](HANDOFF-history-2026-09-30.md)
