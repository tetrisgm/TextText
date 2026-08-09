# TextText.app handoff

## Current position

Branch `simplify-core-ux` (worktree `~/dev/TextText--work`) carries a bounded
UX simplification pass over the home, workspace, create, and template surfaces.
No engine change: `DocumentSnapshot`, `DocumentRenderer`, `store.ts`, and the
validated template path are untouched, and no mutation path moved.

## UX audit (2026-08-08)

### Top five sources of complexity

1. **Two template surfaces, one of them dead.** The sidebar carried a
   `Templates` row that navigated out of the workspace into the public
   `/templates` catalog, sitting among Starred, Shared with me, and Trash,
   which are workspace places. A second surface, `WorkspaceTemplateStrip`, was
   fully built with about 90 lines of CSS and rendered nowhere.
2. **Two words for one thing.** The composer, the editor toolbar, and the
   gallery say "look". The template detail page said "template", and the
   gallery preview said "theme". Three words, one concept.
3. **The library said the same number twice and drew two rules.** The header
   printed "N items" directly above a filter row whose "All" chip printed the
   same number, and both the header and the toolbar carried a hairline, so the
   page read as three stacked boxes rather than one list.
4. **Empty states pointed at the interface instead of offering an action.**
   "Create your first item above." and "Type a title or paste a link to create
   the first item." both restated the composer placeholder and neither did
   anything.
5. **The landing repeated itself.** Four calls to action above the fold
   competing for the same first click (`Start writing` and `Get started` in the
   nav, `Get started` and `See a live blog` in the hero), a kicker plus a
   headline plus a paragraph all saying the same sentence, four text levels
   inside each step card, and a three-card block naming other products.

### What was simplified

- **Removed the dead template strip.** `WorkspaceTemplateStrip.tsx` and its
  CSS block are gone.
- **Removed the sidebar `Templates` row** (and its icon). Choosing a look now
  happens where the work is: the "Look" select in the composer, and the "Look"
  button in the editor, which previews the real document through the engine.
  `/templates` stays as the public catalog, reached from the landing.
- **One word: "look".** The template detail page now says "All looks" and
  "Use this look"; the gallery preview says "Choose another look" and
  "Use this look" instead of "Try another theme" and "Continue". "Template"
  stays an engine word in code and docs.
- **Library reads as one list.** The duplicate item count is gone and the title
  no longer draws its own rule, so the filter row carries the only hairline.
- **Empty states do something.** The library and folder empty states are a
  plain sentence plus one button. "Create an item" focuses the composer through
  the existing `texttext:create-folder-item` event; a filtered-empty library
  offers "Show all items" instead of pretending nothing exists.
- **Landing: one primary action per surface.** The nav keeps only
  "Get started"; the hero is "Get started" plus "Try it without an account",
  which surfaces `/try` honestly instead of hiding it in the nav. The hero
  kicker is gone, the step cards dropped a heading level, the three
  product-name claim cards are gone, and the download block lost its second
  call to action. `/@demo` moved to a text link beside "Browse the looks".
- **Copy.** Sentence case, no em dashes, no exclamation marks. The hero now
  states what the product is ("Your notes, articles, and saved links in one
  place.") rather than an abstraction.

Net effect on the diff: 283 lines removed against 99 added, most of it CSS.

### What was deliberately not touched

- **The 8-entry template catalog.** `TEMPLATE_CATALOG` was already trimmed from
  25 built-ins to 8 across four categories. Cutting further would drop one of
  the five documented built-ins (article, note, bookmark, gallery, talk) from
  the composer and folder defaults, which is a product decision with migration
  weight, not a presentation cleanup.
- **The sidebar activity calendar** (`SidebarActivity`). It is a real feature
  with a working destination (the date activity view) and it is collapsed by
  default, so it costs one quiet row. Removing it is a feature decision.
- **"Turn into" in the edit action bar.** It sits next to "Look" and both offer
  the word "Article", which is a genuine model collision. It was left alone
  because "Turn into" changes the compatibility `type`, which drives privacy
  and folder behavior, while "Look" is presentation only. They also do not
  currently appear in the same toolbar on the workspace edit path. Renaming it
  needs an owner decision, not a refactor.
- **`/start` staying sign-in first.** `src/app/start/route.ts` documents that
  the classic service shape is sign in, then write. The hero primary action
  still goes there; `/try` became the visible secondary rather than replacing
  it.
- **The `/templates` page's inline stylesheet.** It is self-contained, handles
  both themes, and is not part of the app chrome.
- **Everything below the UI layer.** No change to store, visibility, audit,
  collaboration, sync, or the renderer.

## Verification

Run from `~/dev/TextText--work` against local Postgres (`texttext_dev`); no
production Neon, no deploy, no release.

- `npx tsc --noEmit` clean.
- `npx vitest run`: 104 files, 746 tests, all passing (was 103/740; the new
  file is `src/components/workspace/__tests__/simplification-contract.test.ts`,
  which pins the removals so they cannot creep back).
- `npm run build` succeeds, all routes generated including the eight
  `/templates/[template]` pages.
- `npx eslint` on the changed files reports the same pre-existing
  `set-state-in-effect` errors as `main` and no new problems.

Colors: no new color was introduced. Every changed CSS rule is layout or reuses
existing tokens (`--muted`, `--hairline`, `--ink`), and the two new buttons use
`ac-btn ac-btn-filled` / `ac-btn ac-btn-gray` inside the existing `.applecms`
scope, which already resolves light and dark.

No screenshots: `preview_start` was denied by the permission classifier in this
session, so the pass was verified by build, tests, and reading the token usage
of every changed rule rather than by looking at a running page. A reviewer
should open the home library, an empty folder, the editor "Look" gallery, and
the landing page in both themes before landing.

## Next concrete step

Review the branch, then land it with `merge-gate` from the worktree
(`~/dev/stack/runbooks/workflow.md`). The worktree has its own installed
`node_modules` (a symlink to the canonical tree's copy breaks Turbopack with
"Symlink [project]/node_modules is invalid").

## Blockers

None. `preview_start` is unavailable in this session, so visual confirmation is
open, not blocked.

## Ruled out

- Symlinking `node_modules` into the worktree: Turbopack rejects it outright,
  so `npm ci` in the worktree is the only way to build there.
- Trimming the template catalog below 8: would drop a documented built-in.
- Making `/try` the landing's primary action: contradicts the documented
  sign-in-first decision in `src/app/start/route.ts`.
