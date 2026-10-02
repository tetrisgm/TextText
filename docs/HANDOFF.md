# TextText handoff

## Current work

The October 2 work is the folder-based template redesign, committed through `8b15161f` before the current Bookmarks day-grouping update. Feeds has ranked For You, chronological Latest, grouped cross-publisher Headlines, an in-app reader, and Save to Bookmarks as bookmark TextPacks. Its source window now shows eight sources at a time with explicit loading of more subscriptions and an in-visit bounded cache. A bounded metadata index covers subscriptions across source-list pages, so the news view can load the 25th source and beyond. Notes has tags during card editing, a compact editor, and a Finish, saved card, Edit card cycle for local and shared notes. Command K is centered with action icons and shortcuts, second-press dismissal with focus restoration, forgiving action matching, and monospaced command text. Gallery has an image-first editor with title and caption controls plus a justified image grid that fills rows without cropping; image details now show colors and dimensions from the selected asset, including legacy files. New imports keep dimensions in their TextPack asset metadata. Newly saved bookmarks stay in the Bookmarks inbox reader with compact URL-first capture, Inbox and Archive states, and tag editing and filtering. Blog drafts show a subtitle during writing and align title, subtitle, and body on one measure. That subtitle now reaches Mac and web previews. Saved Blog stories open in a reader with Edit story; new drafts open ready to write, and Publish can return to topic editing. These are TextPack views and editors, not a second content model. Tasks are out of this pass. New local workspaces start with Blog, Bookmarks, Notes, Gallery, Feeds, and Presentations; the Templates folder stays internal. The current local workspace at `~/Documents/TextText` was refined in place; original packs are recoverable under `.texttext/starter-before-refinement-2026-10-02`.

Oracle remains the sole host and storage location. The last shipped release and production receipts are in [the September 30 archive](HANDOFF-history-2026-09-30.md).

The saved Note card now uses a corner pencil control and bottom-aligned tags, following the Supernotes card layout. Its text stays readable in both light and dark themes.

The Bookmarks reader now uses compact previous/next navigation, Reader and Original controls, a sans-serif title/body, and a source line below the title to track Shiori’s public dashboard example. Its items remain bookmark TextPacks, and URL-first capture remains the creation path.

The Gallery detail viewer now gives the image most of the window, keeps dimensions, file size, optional source, caption, and colors in a right inspector, and offers scrollable zoom plus Fit. This follows Resurf’s public image detail view while the assets remain inside the Gallery TextPack.

Feed source creation now starts with a website or feed address, shows discovered sources, and keeps folder/topic choices optional until after discovery. The dialog sizes to its contents. Selecting a source still saves a subscription TextPack in Feeds.

The Blog reader now uses a bold sans-serif title, a long-form serif body, and reading time computed from TextPack content. New Blog drafts have an empty content title and a Title placeholder while retaining a safe TextPack filename. The reader remains a view of the article template, not a separate content type.

The Blog selection toolbar now offers link, heading, subheading, and quote actions alongside bold and italic, following Medium’s documented writing controls. They update the article TextPack Markdown body. The link entry validates web addresses, and its popover closes on outside click, scroll, or Escape.

Empty Blog drafts now show New story in the active header and Blog list while their content title remains blank and the TextPack filename stays safe.

The Notes edit card now keeps tags in a compact bottom row and reduces empty body height; its short-card shape remains under 300 pixels tall in the local browser fixture. The same note TextPack fields drive edit and saved-card views.

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

## Boundaries

- The installed app remains 0.203 build 1151. The rebuilt UI bundle under `mac/build/LocalVault` is test-only and has not been installed or published. Visual parity with the named products has not been established by a side-by-side review on real content. Command K's current shape follows Superhuman's published design guide, not a verified pixel match. Feeds has deterministic ranking over followed sources, but has no durable personal interest/read feedback yet; its reader and coverage page have been checked only with local fixtures. Blog typography and draft creation were compared with a public Medium story and its writing guidance, but its complete editing experience still needs comparison on real content. Artifact's original 28 screenshots described in [the historical plan](plans/artifact-home-replication.md) are not present in this checkout or their former Downloads paths.

## References

- [Content checkpoint](TEXTTEXT_UX_CHECKPOINT.md)
- [File-vault architecture](design/texttext-file-vault-migration.md)
- [Oracle operations](../release/oracle/README.md)
- [Resolved release history](HANDOFF-history-2026-09-30.md)
