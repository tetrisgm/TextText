# TextText handoff

## Current work

The October 2 work is the folder-based template redesign, committed through `e7c86d3a`. The current follow-up gives Feeds an in-app story reader backed by the full feed entry and saves chosen stories as bookmark TextPacks in Bookmarks. The Blog publish preview links to its topic editor. These are TextPack views and editors, not a second content model. Tasks are out of this pass. New local workspaces start with Blog, Bookmarks, Notes, Gallery, Feeds, and Presentations; the Templates folder stays internal. The current local workspace at `~/Documents/TextText` was refined in place; original packs are recoverable under `.texttext/starter-before-refinement-2026-10-02`.

Oracle remains the sole host and storage location. The last shipped release and production receipts are in [the September 30 archive](HANDOFF-history-2026-09-30.md).

## Verification

- October 2 checks: TypeScript, focused Vitest tests, Swift starter tests, and the rebuilt local browser contract in light and dark passed. Browser checks cover bookmark reading and capture, story and note creation, multi-image viewing, feed headlines, command navigation, save and recovery. The latest browser run also verifies the full-entry feed reader and a feed story saved as a bookmark TextPack. Screenshots are saved under `/tmp/texttext-*-reference.png` on this Mac.

## Boundaries

- The installed app remains 0.203 build 1151. The rebuilt UI bundle under `mac/build/LocalVault` is test-only and has not been installed or published. Visual parity with the named products has not been established by a side-by-side review on real content. Feeds still lack ranking and story grouping, and its in-app reader has been checked only with a local fixture. Blog needs a closer Medium comparison on real content. Artifact's original 28 screenshots described in [the historical plan](plans/artifact-home-replication.md) are not present in this checkout or their former Downloads paths.

## References

- [Content checkpoint](TEXTTEXT_UX_CHECKPOINT.md)
- [File-vault architecture](design/texttext-file-vault-migration.md)
- [Oracle operations](../release/oracle/README.md)
- [Resolved release history](HANDOFF-history-2026-09-30.md)
