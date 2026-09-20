# Artifact workspace verification, September 19, 2026

Local product work on the Mac, not a release. Local Postgres and production
Next.js builds were used throughout. Originals are in
`~/Downloads/artifact-reference/`; the design contract is [DESIGN.md](../DESIGN.md).

## Result

- Home, Headlines, Notes and Profile share Artifact's column, typography,
  surfaces, search, topic strip and bottom navigation in light and dark.
- Notes uses the existing editor, folders, collaboration and document schema.
  Profile contains Read Later, Reading History, interests, hidden publishers,
  subscriptions, the library, and the settings popover.
- First news setup asks for interests. Hide publisher and Hide article are
  personal, audited and reversible, including in Latest. History is ordered
  by reading time. Read Later contains explicit saves.
- Individual articles and grouped coverage use the same contextual sheet,
  including long press and secondary story actions.
- Workspace-scoped, bounded feed caching and warmed reader/editor imports
  keep navigation fast. A cold-mounted lazy editor retains its component
  identity after warming, preserving focus and the live document.

## Notes and collaboration

`scripts/verify-artifact-notes.ts` checks New Note, immediate title/body input,
server persistence, permanent URL, reload, and reopening in Chromium and WebKit.
`TEXTTEXT_TEST_DELAYED_NOTE=1` delays creation by 1.8 seconds and leaves the editor
before reopening. Both modes pass; owned scratch notes are removed afterward.
WebKit's cancelled fetch errors immediately following intentional full-page
navigation are counted separately from editing errors.

The checks exposed and fixed four writing failures: missing optional bodies
created orphan drafts; a fast create could miss the URL handoff; an optimistic
Yjs root could replace early typing with the blank server baseline; simultaneous
autosaves could mistake a revision collision for a retired epoch. Revision
collisions now re-read and merge with bounded retries; genuine epoch changes
still stop editing and preserve recovery. Relative caret positions keep words
intact during simultaneous input.

`scripts/bench-sync.ts --runs 8 --budget 200 --simultaneous-runs 50` passed:
first-key p95 69 ms left-to-right and 72 ms right-to-left, sentence p95 55 ms.
All 50 simultaneous rounds retained both words and converged. Convergence was
220 ms median, 281 ms p95 and 303 ms worst on the final run. An earlier stress
run also preserved both edits across 50 rounds but had a 3.7 second outlier.

## Navigation

`scripts/bench-actions.ts --runs 12 --budget 200` against the production build:

| Action | Median | p95 | First open |
| --- | ---: | ---: | ---: |
| Open article | 82 ms | 166 ms | 124 ms |
| Back to feed | 37 ms | 42 ms | 35 ms |
| Switch channel | 57 ms | 67 ms | 61 ms |
| Open folder | 40 ms | 43 ms | 111 ms |
| Open Notes | 9 ms | 14 ms | 13 ms |
| Open note | 38 ms | 40 ms | 46 ms |

Every sample completed. The benchmark fails missing actions and unmet budgets.
It measures content becoming ready, before the existing 240 ms navigation slide
finishes. The same four original actions at `0b6e3ac9` had p95 values of 538,
2200, 423 and 70 ms respectively. Notes was added after that checkpoint.

## Large-note input

`scripts/bench-note-input.ts` creates and removes its own 1 MB notes. With
`TEXTTEXT_BASELINE_URL` pointing at `0b6e3ac9`, 54 real keystrokes per browser:

| Browser | Previous typing p95 | Current typing p95 | Previous/current scroll |
| --- | ---: | ---: | ---: |
| Chromium | 20.7 ms | 18.2 ms | 118 / 118 fps |
| WebKit | 76 ms | 70 ms | 30 / 30 fps |

Input latency runs from the input event to the second animation frame, matching
the existing editor benchmark. Missing input events fail the check, as do
regressions over 20% (with a 40 ms floor for timing noise).

## Checks and limits

Production build/typecheck, 3,499 tests in 371 files (116 tests skipped), focused
editor/navigation checks, and 16 relevant local database tests pass. Targeted lint has warnings,
no errors. Browser checks cover 393 px phones and 1440 px desktop, both themes,
Home, article actions, reading, Headlines, Notes, Profile, interests, saved
articles, history and settings, with no horizontal overflow. The Profile popover
returns keyboard focus to its gear button when dismissed in both engines.

These are browser-engine and local production-build results. Physical Safari
gestures, the shipped native application and deployed production were not
verified or released. Headlines displays actual source clusters; no coverage,
reading streaks or social activity were invented to fill the screenshots.
