# TextText.app handoff

## Current position

Branch `simplify-core-ux` (worktree `~/dev/TextText--work`), two commits, pushed.
A UX simplification pass driven by screenshots of the built app rather than by
reading source. No engine change: `DocumentSnapshot`, `DocumentRenderer`,
`store.ts`, the validated template path, visibility, and audit are untouched.

## How this was verified

`.texttext/shoot.mjs` (gitignored) is a single foreground run: it starts
`next start`, drives headless Chromium across every surface in light and dark
at 1440px plus a 390px pass, writes PNGs, and kills the server. Nothing is left
running. Reproduce with:

```bash
cd ~/dev/TextText--work && npm run build && node .texttext/shoot.mjs /tmp/shots 3111
```

It creates a real guest workspace through `/try`, opens the look gallery, types
into the capture field, presses Enter, and photographs the result, so the
create path is exercised end to end rather than asserted.

Six capture rounds informed the work. The first round is what turned this from
a copy-editing pass into a real one.

## What the screenshots showed that reading the code did not

1. **Every look was named after another company's product.** Medium article,
   Apple Notes, Instapaper reader, Pinterest board, YouTube video, Apple
   Reminders, Notion project, Substack newsletter. All eight, in the composer,
   the editor toolbar, the public catalog, and the gallery, with descriptions
   that said "inspired by <brand>". The engine stylesheet shipped the same names
   as CSS comments and asked for Roboto on the talk look.
2. **The in-app look gallery did not scale its previews.** Each card rendered
   the document at full width, so all eight cards showed the same top-left
   fragment. The one surface whose entire job is telling looks apart could not.
3. **Creating an item was a form.** Folder select, look select, text field,
   button. Two decisions before typing was possible.
4. **A new workspace was a manual.** Provisioning inserted five documents
   explaining the product. The first thing anyone saw was `## Create / Press C
   anywhere in the workspace`, rendered as raw Markdown in the body textarea.
5. **The editor showed reader chrome while writing:** an avatar, the workspace
   name, "1 min read", and a date, above a description field that stood between
   the title and the first sentence.

## What changed

**Creating is one action.** The capture row is a text field. Enter creates and
opens; Shift+Enter is a newline. The destination follows from what you typed, so
a pasted link lands with the links you save wherever you typed it, and the look
follows from the folder. Both stay changeable afterwards, in the editor, where
you can see what they do.

**A new workspace is empty.** `provisionWorkspaceDefaults` creates the folders
and nothing else; `ensureFirstArticleDraftPath` already created a draft on
demand, so the first visit opens one untitled document. `WORKSPACE_STARTER_POST_SLUGS`
still names the old seeded slugs so existing workspaces keep them out of the
try-before-signup item cap.

**The editor is a document.** No byline, reading time, or date in edit mode. The
description appears once it has content or once you pick "Add a description"
from the overflow menu. Declared fields a look does not place sit in a closed
disclosure instead of an always-open "Details" form.

**The looks are named for the documents they make:** Article, Note, Bookmark,
Gallery, Talk, Checklist, Project, Newsletter. Ids and versions are untouched,
so every pinned document still resolves. `builtin-templates.test.ts` now fails
if any built-in name or description matches a competitor brand.

**The look gallery works.** Cards scale like the public catalog, and a document
with nothing in it previews the template's own validated exemplar, with one line
saying so. "Try another theme" and "Continue" became "Choose another look" and
"Use this look", so the product has one word for the concept.

**The library reads as a list.** Default view is rows, not cards. One hairline,
no duplicated item count, no type badge repeating the icon, no "No preview"
where a document simply has no text yet, no drag-to-resize corner on the capture
field.

**Craft fixes the critique confirmed.** The composer's submit button had lost
its accent fill to `apple.css`, which loads after `broadsheet.css` and
neutralises `.ac-icon-btn`, so creating an item was not the visually dominant
action anywhere on the page; it is now the only filled control on the Library.
"Stop editing" carried `ac-btn-blue`, a class that exists in no stylesheet.
Escape inside the look gallery closed the gallery and then reached the editor's
own Escape layer, throwing the writer out of the document in one keystroke.
Opening a look preview auto-scrolled to the document's footer. The gallery never
marked the look already applied. The three writing fields removed their focus
ring and put nothing back. Save feedback rendered success as an empty string, so
the only save message anyone saw was the red one, and that red had no dark
variant. The landing header and hero showed the same pill, same label, same
href, inside the first viewport; the header is now a quiet "Sign in" and the
narrow-viewport rule that hides the left nav items was scoped so it no longer
takes sign-in with it. The "Familiar looks" demo rendered a 680px reading
measure inside a 1903px canvas scaled to 0.62, leaving about 380px blank on each
side; it now shows the measure at true size.

**Removed:** the dead `WorkspaceTemplateStrip` and its CSS, the sidebar row that
navigated out of the workspace into the public catalog, four competing calls to
action on the landing page, a heading level in each landing card, three cards
naming other products, and the landing hero kicker. Display headings use
`text-wrap: balance`, which fixes the one-word orphan the hero had at every
width tested.

Across both commits: 660 lines removed, 366 added.

## Open, and worth doing next

Two projects and a short tail. Everything the critique ranked HIGH is closed
except the two below, both of which were left alone on purpose.

1. **The body is a plain textarea over Markdown.** A heading is `## Create`
   while you write and a heading while you read, so the look the editor
   promises is not the look you are typing into. This is the largest remaining
   distance from Notion and it is not a cleanup: the deps already carry Tiptap
   plus `SlashCommand.ts`, `WikiLink.ts`, and `tiptap-suggestion.ts`, which
   suggests a rich editor existed before the unified rewrite. Its own project.
2. **The guest workspace cannot materialize, and says so in red.**
   `/api/collab/{postId}/materialize` returns 403 for a `/try` workspace, so
   "Document could not be saved" sits in the corner of the first screen a new
   person sees. Cause: `getCollabRequestAccess`
   (`src/lib/collab/access.server.ts`) resolves a signed-in user or a document
   capability token and nothing else, so the `blog-edit-auth` guest cookie that
   owns the workspace resolves to no role. Content is not lost: the editor's
   own autosave writes through the server actions, which do understand guest
   ownership. **Pre-existing and untouched by this branch** (neither file
   appears in the diff). Left alone deliberately, because widening an auth
   boundary as a side effect of a design pass is the wrong way to do it. Fix it
   on its own branch with its own test.

The tail, all confirmed by the critique and all MEDIUM:

- **The hero mockup is not the product.** Its sidebar items, structure, and
  visual language differ from the real app, so the first impression promises a
  different thing than the one that opens.
- **Clicking a look opens a preview rather than choosing it,** and there is no
  way to step to the next look from inside that preview. Changing it is a
  product decision about what a card click means.
- **Two stylesheets style the same components.** `workspace.css` loads after
  `broadsheet.css` and overrides it; several `broadsheet.css` rules are now
  dead for the workspace surfaces. Worth collapsing.
- **The Talk exemplar still points at a real conference talk on YouTube.**
  Nothing third-party loads any more, because miniatures render a still, but
  the full-size page will embed the player. Replacing it needs owned media.
- **`--bg-soft` is `#f5f5f7` in light and `#000000` in dark**
  (`src/styles/tokens.css`). Every gentle tint becomes a black hole in dark.
  Left alone because the token has wide blast radius; the per-look papers it
  affected were fixed directly instead.

Full ranked list with per-finding evidence, including the ones already closed:
the workflow journal under
`~/.claude/projects/.../subagents/workflows/wf_aea78981-840/`.

## Deliberately not touched

- **The eight-entry catalog size.** Already trimmed from 25 to 8. Cutting
  further would drop one of the five documented built-ins.
- **The accent colors baked into the engine stylesheet**, which are the exact
  brand values of the products the looks were named after (`#1a8917`,
  `#e60023`, `#ff0033`, `#0a84ff`, and the Instapaper and Notes paper tones).
  Renaming was safe; restyling changes how existing pinned documents render, so
  it is an owner decision. Roboto was dropped from the talk look because it was
  pure imitation and inert on macOS anyway.
- **The sidebar activity calendar.** A working feature, collapsed by default.
- **"Turn into" in the edit action bar.** It collides with "Look" on the word
  "Article", but it changes the compatibility `type`, which drives privacy and
  folder behavior. Renaming it is a product decision.
- **`/start` staying sign-in first**, per the documented decision in
  `src/app/start/route.ts`. `/try` became the visible secondary action instead.

## Verification

Run from `~/dev/TextText--work` against local Postgres (`texttext_dev`). No
production Neon, no deploy, no release, no scheduled anything.

- `npx tsc --noEmit` clean.
- `npx vitest run`: 104 files, 746 tests, all passing.
- `npm run build` succeeds.
- `npx eslint src`: 24 errors, all pre-existing `set-state-in-effect` and
  memoization warnings. `main` has 27.
- Every surface photographed in light and dark. No new color was introduced;
  changed rules are layout or reuse existing tokens.

The worktree needs its own installed `node_modules`: symlinking the canonical
tree's copy makes Turbopack fail with "Symlink [project]/node_modules is
invalid".

## Next concrete step

Review the branch against the screenshots, then land it with `merge-gate` from
the worktree (`~/dev/stack/runbooks/workflow.md`). Then take item 1 above on its
own branch.
