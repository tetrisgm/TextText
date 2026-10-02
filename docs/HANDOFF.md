# TextText handoff

## Current work

The October 2 work is the folder-based template redesign, committed through `51c24d05`. The current follow-up gives Bookmarks folder-wide All, Unread, Favorites and title/site filters over bounded local TextPack metadata. These are TextPack views and editors, not a second content model. Tasks are out of this pass. New local workspaces start with Blog, Bookmarks, Notes, Gallery, Feeds, and Presentations; the Templates folder stays internal. The current local workspace at `~/Documents/TextText` was refined in place; original packs are recoverable under `.texttext/starter-before-refinement-2026-10-02`.

Oracle remains the sole host and storage location. The last shipped release and production receipts are in [the September 30 archive](HANDOFF-history-2026-09-30.md).

## Verification

- October 2 checks: TypeScript, focused Vitest tests, Swift starter tests, and the rebuilt local browser contract in light and dark passed. Browser checks cover bookmark reading and capture, story and note creation, multi-image viewing, feed headlines, command navigation, save and recovery. The latest local browser check also covers bookmark status filters and finding an item past the first list page. Screenshots are saved under `/tmp/texttext-*-reference.png` on this Mac.

## Boundaries

- The installed app remains 0.203 build 1151. The rebuilt UI bundle under `mac/build/LocalVault` is test-only and has not been installed or published. Visual parity with the named products has not been established by a side-by-side review on real content. Feeds still lack ranking and story grouping; Blog publishing still needs a Medium-like preview flow. Artifact's original 28 screenshots described in [the historical plan](plans/artifact-home-replication.md) are not present in this checkout or their former Downloads paths.

## References

- [Content checkpoint](TEXTTEXT_UX_CHECKPOINT.md)
- [File-vault architecture](design/texttext-file-vault-migration.md)
- [Oracle operations](../release/oracle/README.md)
- [Resolved release history](HANDOFF-history-2026-09-30.md)
