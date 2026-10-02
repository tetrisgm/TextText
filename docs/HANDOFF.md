# TextText handoff

## Current work

The October 2 work is the folder-based template redesign, committed through `13b5842c`. Feeds has ranked For You, chronological Latest, grouped cross-publisher Headlines, an in-app reader, and Save to Bookmarks as bookmark TextPacks. Notes has tags during card editing, a compact editor, and a Finish, saved card, Edit card cycle for local and shared notes. Command K is centered with action icons and shortcuts, second-press dismissal with focus restoration, forgiving action matching, and monospaced command text. Gallery has an image-first editor with title and caption controls plus a masonry grid preserving image proportions. Newly saved bookmarks stay in the Bookmarks inbox reader with compact URL-first capture, Inbox and Archive states, and tag editing and filtering. Blog drafts show a subtitle during writing and align title, subtitle, and body on one measure. That subtitle now reaches Mac and web previews. Saved Blog stories open in a reader with Edit story; new drafts open ready to write, and Publish can return to topic editing. These are TextPack views and editors, not a second content model. Tasks are out of this pass. New local workspaces start with Blog, Bookmarks, Notes, Gallery, Feeds, and Presentations; the Templates folder stays internal. The current local workspace at `~/Documents/TextText` was refined in place; original packs are recoverable under `.texttext/starter-before-refinement-2026-10-02`.

Oracle remains the sole host and storage location. The last shipped release and production receipts are in [the September 30 archive](HANDOFF-history-2026-09-30.md).

## Verification

- October 2 checks: TypeScript, focused Vitest tests, Swift starter tests, and the rebuilt local browser contract in light and dark passed. Browser checks cover bookmark reading and capture, story and note creation, multi-image viewing, feed headlines, command navigation, save and recovery. The latest browser run verifies Blog title-to-subtitle-to-body focus and saved subtitle, URL capture into the Bookmarks reader, Gallery title/caption persistence, centered Command K, note tags, cross-publisher coverage, and the full-entry feed reader. Screenshots are saved under `/tmp/texttext-*-reference.png` on this Mac.
- The Note Finish, saved card, Edit card cycle passes TypeScript, the local UI bundle build, and the full local browser contract. The contract also caught and verified a fix for captured links using the Note template: their Article reader takes precedence over the Note card. The saved card screenshot is `/tmp/texttext-note-card-reference.png`.
- The bookmark Inbox, Archive, and tag controls pass TypeScript and the local browser contract. The bookmark screenshot is `/tmp/texttext-bookmark-reference.png`.
- The Gallery masonry grid passes TypeScript and a browser check with portrait and landscape images. Its screenshot is `/tmp/texttext-gallery-grid-reference.png`.
- Blog subtitle previews pass the Mac and web preview tests, TypeScript, and the full local browser contract; `/tmp/texttext-blog-reference.png` shows the list result. The Blog reader/edit transition passes TypeScript, the local UI bundle build, and browser checks for opening a saved story, returning from Publish to edit topics, saving to the reader, and editing again. `/tmp/texttext-blog-reader-reference.png` shows the reader.

## Boundaries

- The installed app remains 0.203 build 1151. The rebuilt UI bundle under `mac/build/LocalVault` is test-only and has not been installed or published. Visual parity with the named products has not been established by a side-by-side review on real content. Command K's current shape follows Superhuman's published design guide, not a verified pixel match. Feeds has deterministic ranking over followed sources, but no durable personal interest/read feedback yet; its reader and coverage page have been checked only with local fixtures. Blog has a reader/edit transition, but still needs a closer Medium comparison on real content. Artifact's original 28 screenshots described in [the historical plan](plans/artifact-home-replication.md) are not present in this checkout or their former Downloads paths.

## References

- [Content checkpoint](TEXTTEXT_UX_CHECKPOINT.md)
- [File-vault architecture](design/texttext-file-vault-migration.md)
- [Oracle operations](../release/oracle/README.md)
- [Resolved release history](HANDOFF-history-2026-09-30.md)
