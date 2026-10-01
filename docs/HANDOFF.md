# TextText handoff

## Current work

TextText 0.203 build 1150 shipped on 2026-10-01 from `eef38b7e`; `e3f75ce7` records the release in source. The public app and release downloads run on Oracle, and `/Applications/TextText.app` is the sole installed copy. It is notarized, Developer ID signed, arm64, and contains the three extensions plus the bundled `texttext` command.

The product now uses ordinary folders and self-contained TextPacks. The Mac app, web workspace, Finder projection, and agent commands share the same document model. The starter library contains eleven item TextPacks plus Reading list, Contact sheet, and Reference index folder presets. The shipped release is recorded once in `Shoku's Space/My Notes/TextText Changelog.textpack`.

Media, PostgreSQL, retained database dumps, and Mac release artifacts all live on the Oracle host. There is no Cloudflare R2 or Vercel Blob dependency. Relevant implementation commits are `bb67703b`, `ac930295`, and `7d17d419`.

## Verification

- The complete release gate passed on `eef38b7e`: 4,157 web tests, 109 database tests plus four scale tests, live token/workflow/sync/collaboration checks, the full Swift suite, TypeScript, local promotion, TestFlight packaging, and Apple release checks.
- Oracle deployed identity `texttext-0_203-1150`. Authenticated production smoke tests created, read, edited, audited, and removed a scratch note.
- Public appcast, immutable ZIP, stable download, version, and sign-in routes pass. Public artifact hashes match the private Oracle files. The ZIP supports range requests.
- TextText and Algorave services are active with zero restarts. Both backup timers are active; their newest private archives have readable `pg_restore` tables of contents.
- Cached item open improved from 590.9 ms to 339.6 ms p95 in the bounded six-sample comparison after `7f59e8fd`. This is a useful improvement, not the 100 ms target. The benchmark does not prove the absence of a memory leak.

## Boundaries

- Oracle-local retention protects against application and database mistakes but not loss of the Oracle VM or its block storage. This is the deliberate Oracle-only storage boundary.
- Interactive OAuth was not re-entered during the automated release. `/signin` is live, native Apple sign-in passed its release checks, and the previously installed flow was accepted manually.

## References

- [Content checkpoint](TEXTTEXT_UX_CHECKPOINT.md)
- [File-vault architecture](design/texttext-file-vault-migration.md)
- [Performance receipt](file-vault-performance-2026-09-30.md)
- [Oracle operations](../release/oracle/README.md)
- [Media storage](MEDIA-STORAGE.md)
- [Release storage](RELEASE-STORAGE.md)
- Resolved history: [September 30 archive](HANDOFF-history-2026-09-30.md)
