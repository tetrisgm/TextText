# T2: bookmarks and notes web UI

You are building the web UI for Write's bookmark capture pipeline and
polishing the notes list. The backend is DONE and in this branch; you build
presentation only.

## Backend contract (already live in this branch, do not modify)

- A bookmark is a post with `type: "bookmark"`, `links[0].href` = the URL,
  and two new fields on the Post type (src/lib/content.ts):
  - `captureStatus?: "pending" | "captured" | "failed"`
  - `capture?: BookmarkCapture` = `{url, title?, siteName?, description?,
    screenshotUrl?, htmlUrl?, capturedAt?, capturedBy?, error?}`
- The readable extraction, when captured, is the post BODY (markdown).
- Bookmarks/notes are unlisted forever; they render only inside the
  authenticated workspace (FolderPage).

## File ownership (STRICT)

- You may edit: `src/components/FolderPage.tsx`.
- You may CREATE new files under `src/components/bookmarks/` and CSS
  Modules next to them (`*.module.css`). Import styles as modules; do NOT
  edit src/app/layout.tsx or any global stylesheet under src/styles/.
- NEVER touch: PostWorkspaceShell.tsx, actions.ts, anything in src/lib/,
  src/app/ pages, package.json.
- Commit nothing. Run no dev servers (sandbox cannot bind ports). Verify
  with `npx tsc --noEmit` and `npm run build`.

## What to build

1. **Bookmark cards** (in the bookmarks folder list): favicon (use
   `https://icons.duckduckgo.com/ip3/<host>.ico` with a plain-circle
   fallback), title, host, one-line description (`capture.description`
   fallback to body first line), and a small screenshot thumbnail when
   `capture.screenshotUrl` exists. Status chip: pending = quiet "capturing"
   with subtle pulse honoring prefers-reduced-motion; failed = muted
   "capture failed" (never red-alarm; this is a note-taking app, not ops).
2. **Bookmark reader**: clicking a bookmark card opens the post page as
   today; ADD to the card an inline affordance row: "open original"
   (links[0].href, target _blank rel noopener), "archived copy"
   (capture.htmlUrl, only when present), "screenshot" (capture.
   screenshotUrl, only when present).
3. **Notes list polish**: first body line as a muted preview under the
   title (strip markdown syntax crudely: leading #, *, >, `).
4. Empty states: bookmarks folder with none ("Save your first link"),
   notes folder with none ("Write your first note"). Quiet, one line.

## Design contract (non-negotiable, from DESIGN.md)

- Check EVERY color in light AND dark mode; use the existing CSS custom
  properties (--ink, --muted, --hairline, --bg-soft) rather than literals.
- No em dashes in copy. Sentence case. No exclamation marks.
- Nothing animates on load except the allowed pulse, and it must be
  disabled under prefers-reduced-motion.
- Taste over decoration: when unsure, remove.

## Verify

- `npx tsc --noEmit` clean, `npm run build` clean.
- State in your summary how each state renders: pending, captured with
  screenshot, captured without artifacts, failed, and both empty states.
