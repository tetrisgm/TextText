# TextText.app handoff

## Current position

One branch off `main`: **`simplify-core-ux`**, with `live-collab-proof` merged
into it. It carries a UX simplification pass, a live browser proof that agents
participate the way people do, and the fixes both of those turned up.

Everything below was found by looking at the built app in a real browser, or by
adversarially verifying a claim against the source. Not by reading alone.

## How to see it

```bash
npm run build
node .texttext/shoot.mjs /tmp/shots 3111
npm run eval:collaboration:browser
```

The first captures every surface in light and dark at 1440 and 390. The second
drives two real people and an agent through 24 checks. `.texttext/shoot.mjs` is
gitignored because it is a session tool; `scripts/verify-live-collaboration.ts`
is committed because it is a contract.

## What changed

### Creating is one action

The capture row was a folder select, a look select, a text field and a button.
It is a text field. Enter creates and opens, the destination follows from what
you typed, and the look follows from the folder. Both stay changeable
afterwards, in the editor, where you can see what they do.

A new workspace is empty. It used to be provisioned with five documents
explaining the product, so the first thing anyone saw was a manual rendered as
raw Markdown. The first visit creates one untitled draft and opens it.

The capture button had lost its accent fill to `apple.css`, which loads after
`broadsheet.css` and neutralises `.ac-icon-btn`, so the action the page exists
for was a grey glyph. It is the only filled control on the Library.

### The editor is a document, not a form

No byline, reading time or date while writing. The description appears when it
has content or when you ask for it. Fields a look declares but does not place
sit in a closed disclosure. The exit control is quiet rather than a browser
default. Focus rings are back on the three writing fields. Save feedback says
"Saved" instead of only ever speaking to report a failure.

### Looks are looks, not other people's products

All eight were named after competitors, with descriptions saying "inspired by".
They are Article, Note, Bookmark, Gallery, Talk, Checklist, Project and
Newsletter, and a test fails if a built-in name or description ever matches a
competitor again. Ids and versions are untouched, so pinned documents resolve.

The gallery rendered each card at full width, so all eight showed the same
top-left fragment. Cards scale, an empty document previews the template's own
example, the name sits under the preview rather than on the words it labels, the
document paints its paper to the card edges, eight looks divide into four
columns, the applied look is marked, and you can step between looks.

Miniatures never load a player: `DocumentRenderer` takes a `preview` flag and
draws a still, which removed a live `www.youtube.com` iframe from a public page.
Other embeds use `youtube-nocookie`. The Talk example borrows nobody's video:
`videoUrl` is optional, because a talk page exists before the recording does.

The gallery example used to lie. Six near-identical frames of one stock laptop
photo were captioned as coastal fog, with alt text like "Morning light crossing
a coastal dune". Four images were opened, described from what is in them, and
given a matching title. A test requires real alt text.

### Agents participate the way people do

`scripts/verify-live-collaboration.ts` starts the built server, signs in two
dev-login accounts as two people, shares an item through the real share dialog,
and drives two Chromium browsers plus an agent over the two transports a hosted
client uses. 24 checks, all passing.

It proves each human's caret paints in the other's browser under their own name;
a watcher who is not typing sees the caret move in about 1.2 s; an agent joins
the same presence row with a caret of its own; ChatGPT, Claude, Cursor and Codex
each render as themselves; an agent's append and update land in an open editor
with no reload and survive the human's next save; an agent writing while both
humans type reaches both and loses nobody's words; and a sidebar-assistant edit
is indistinguishable from a human's.

Fixes it forced, or that the mapping pass found:

- The sidebar assistant published no presence, so its edits arrived with nobody
  attached. The gate excludes only human actors now.
- Presence was write-only, so a watcher learned where a cursor was only from
  their own slow heartbeat. The route answers GET and the provider polls it.
- `hasActiveCoEditors` counted the caller, so an agent routed its own write down
  the contended path on the strength of itself.
- The caret read the peer's unverified self-declaration while the avatar was
  server-resolved, so one person could be two colours and any name.
- An agent minted a fresh Yjs client id per publish, accumulating a ghost
  collaborator per write.
- An agent's caret parked at the end of the body; it selects the named section.
- A reader could not see that anyone was in the document at all.
- A person writing alone saw an avatar of themselves.
- Field values were the one thing an agent could not change mid-session, because
  the live vocabulary did not carry them. It carries fields, assets and the
  pinned template now, and the refusal is gone.
- A trashed item answered 403, so someone holding it open was told they had lost
  access. The routes answer 410 and the provider says it was moved to Trash.
- The co-editing relay had no test at all. Eight now cover it.

### The demo told everyone it was broken

`materialize` returned 403 for a `/try` workspace, so a red "Document could not
be saved" sat on the first screen a new person ever sees, while the item saved
fine through the editor's server actions. `getCollabRequestAccess` knew about
accounts and capability links but not about the token that owns an unclaimed
workspace. It falls back to `getBlogEditAccess`, the same authority the write
actions already grant, and only when there is no user, no capability, an
unclaimed workspace, and the workspace holding that post. Eight tests pin those
conditions, including that it never widens an account decision.

### Both themes, and the small print

`--bg-soft` was a gentle step from white in light and pure black in dark, so
every tinted surface was a hole. Note and Checklist lost their paper entirely in
dark and set a `--muted` measuring about 3:1 against their light papers. Display
headings use `text-wrap: balance`. At 390 px the history chrome painted over the
editor toolbar and swallowed taps, the title cleared the toolbar by 4 px, the
save chip sat translucent on the reading column, and the look detail bar wrapped
mid-phrase on all four controls.

The landing had four calls to action competing for the same first click, five
heading sizes across peer sections, an eyebrow on every card restating the title
beneath it, one sentence printed twice, a document demo that was 65% empty
surface, and a mockup naming places the real workspace does not have.

### Stylesheet layering

`workspace.css` is imported after `broadsheet.css` and is the last word on the
workspace surfaces. That is written at the top of the file now, because a fix in
this pass landed in the wrong one before it was noticed. Fifteen rules in
`broadsheet.css` set nothing `workspace.css` had not already reset and were
removed; the one using `!important` was left alone.

### The editor shows the document, not its source

`## Create` used to be `## Create` while writing and a heading while reading.
It is a heading in both now. `MarkdownSurface` renders the Markdown source
itself, styled: headings at heading size with the hashes receded, emphasis as
emphasis, code in monospace, quotes quiet and italic, list markers receded.

The body is still Markdown. `content.body` is still a string, the Y document
still holds it as a `Y.Text`, and materialization, sync, the agent caret
helpers and every stored baseline are untouched. Nothing migrated.

Three decisions are load-bearing:

1. **One `white-space: pre-wrap` element, inline children, newlines as literal
   characters.** `textContent` is then exactly the source. One block element
   per line makes `textContent` silently drop every newline and puts
   remote-caret offsets out by one per line.
2. **React does not own the children.** The browser inserts text nodes as the
   writer types, React does not know about them, and reconciling against its
   own tree leaves both copies in the DOM: the text appears twice. The subtree
   is built imperatively, only when the content or the peer selections actually
   changed, with the local selection preserved across the rebuild.
3. **Remote carets carry no text node.** The label comes from CSS `content`, so
   splicing a colleague's cursor into the middle of a line never shifts a
   source offset. Segments split at caret offsets so a cursor sits at the exact
   character rather than snapping to the nearest style boundary.

It took three attempts and the first two failed for the same reason, which is
worth knowing: `beginBackgroundSelection` in `PostWorkspaceShell` treated
`[contenteditable="true"]` as interactive but not `plaintext-only`, so the
marquee handler swallowed every click on the surface and focused the scroll
container instead. The symptom was a caret probe reading `-1` forever while
typing appeared to work. The allowlist now matches any editable host. A
five-line probe (`document.activeElement` right after a click) would have found
it in minutes; two attempts were spent theorising instead.

The live run proves it end to end: 24/24, with the writer's insertion point
moving 594 to 582 and an idle watcher seeing a colleague's caret move after
1239 ms, on a body whose every line carries that run's stamp.

### The Mac app is the same UI, and now says where it is pointing

The Mac client is a native window around the web app (`WebAppWindowController`
is a `WKWebView` on the server origin), so everything above appears there too.
The native parts around it are the File Provider mirror to `~/TextText/*.md`,
Spotlight, Shortcuts, quick capture, the capture agent, and the `texttext` CLI.

Three things made a dev launch look like a broken app:

1. **It silently talked to production.** With no `TEXTTEXT_SERVER`, no linked
   credential and no release plist, `resolveServerOrigin` fell through to the
   product origin, so `swift run` read and wrote the LIVE workspace. A build
   with no `SUFeedURL` is not a release build, and now defaults to
   `http://localhost:3000`. Every run prints the origin it chose, and why, to
   stderr on first use.
2. **An unreachable origin was a blank white window.** The window controller
   implemented no `didFail` handler at all. It now renders what it tried to
   reach, the underlying reason, the command to start the server, and a Retry
   button.
3. **`npm run mac:dev`** (`mac/scripts/dev-run.sh`) waits for the server to
   answer before launching, so starting the client too early is a clear message
   rather than a mystery. `npm run mac:build` and `npm run mac:test` are there
   too.

4. **Two executables shared one filename.** The app target `TextText` and the
   CLI product `texttext` are the same path on a stock case-insensitive Mac
   volume, so whichever linked last won `.build/debug/TextText`. Running the
   binary straight after `swift test` ran the CLI and looked like the app
   failing to launch. The app target is `TextTextApp` now. The shipped bundle
   binary is still `TextText.app/Contents/MacOS/TextText`: `build-app.sh`
   copies `TextTextApp` into that name, so `CFBundleExecutable` and everything
   about a release build are unchanged.

### The looks answer to a named reference now

The owner named five: Apple Notes, Notion, Medium, and the case-study and
video views from ramine.net. Every look was measured against its reference
before anything changed, and the result was one systemic fault rather than
eight styling ones: **every title rendered between 1.6x and 2.1x its
reference** (article 89.6px against Medium's 42, note 53.6 against Notes' 34,
talk 41.6 against a YouTube title's 20). A single base clamp,
`clamp(2.5rem,6vw,5.5rem)`, was doing it. All eight now land within about a
pixel of their reference.

Three more faults the measurements or the captures turned up:

- **Tinted paper stopped mid-window.** `.tt-document` is `min-height:100%`
  against a parent with no definite height, so a short document painted its
  paper to the last line and let the app's background show under it. Visible
  on exactly the two looks whose paper is not white. A fixed layer behind the
  content fills the window at any length; `data-preview` keeps gallery
  miniatures out of it.
- **`alignment: "start"` only reached mastheads.** Note declares it and puts
  its title straight in the stack, so the rule never applied.
- **The editor's focus ring was a panel.** A 7% accent tint sized to the field
  was a hint on a one-line title and a coloured box around the whole document
  on a body. Gone; the caret is the indicator, as it is in every editor people
  like. Forced-colors still gets a real outline.
- **44px of nothing between title and body while writing.** A look spaces its
  masthead for a byline and a date, which edit mode hides. Edit mode uses the
  look's own `--tt-gap-md` instead.

Per look, against its reference: Note is white paper with the date centred
above the title, not cream with it below. Article is a centred serif display
title over a sans body, closed by a hairline, with centred serif section
headings. Project drew borders around blocks that Notion does not draw at all.
Video's title sits under the video at reading weight rather than over it as a
headline. **Case study is new**: a horizontal stack with the argument at
34rem on the left and its evidence sticky on the right, collapsing to one
column below 900px.

Names stay neutral. `builtin-templates.test.ts` fails if a built-in name or
description ever matches a competitor, and that test was left in force.

Newsletter was retired from the catalogue at the owner's request. It moved to
`legacyDefinitions` rather than being deleted, so a document already pinned to
it still renders. Retiring a look must never break a document that chose it.

The catalogue is now Article, Note, Bookmark, Gallery, Talk, Case study,
Checklist, Project.

Two things worth knowing for whoever picks this up:

- `.tt-document-editor` is on the **same element** as `.tt-document`, not an
  ancestor. A descendant selector against it silently matches nothing. Two
  rebuilds were spent before the ancestor chain was dumped instead of guessed
  at.
- `.tt-badge` is the row of tags; `.tt-pill` is each tag. Styling the row as a
  pill draws one rectangle around the whole set.

### What a 56-agent visual critique found on top

One agent per look read its own light and dark captures against a written
spec of the product it answers to, then an adversarial verifier tried to
refute each finding against the source. 48 raised, 17 survived, 4 blocking.
Two of the seventeen were against Newsletter and died with it.

Acted on, each re-verified against a fresh capture or measurement:

- **Lists lost the document's left edge.** The agent scoped this to Note; it
  is not. The browser indents a list by 40px, so the first list anyone writes
  in any look breaks the one trait both reference apps have. Fixed at the base
  `.tt-prose`: marker on the shared edge, words after it, wrapped lines
  aligned to the words. Measured 40px off, now 0 at the marker.
- **Article's byline was body copy** - editorial serif at body size, reading
  as the first line of the story rather than metadata.
- **Note's dark paper was warm brown**, a darkened cream: the same sticky-note
  warmth the look's own comment says to keep off the page. Now neutral. Its
  collection card was still cream in light mode too.
- **Bookmark set two serifs**: Georgia named on the title and prose, Iowan Old
  Style inherited by the caption and date from `data-typography="editorial"`.
  One `--tt-font` on the template now covers every child.
- **Three gallery rules were dead.** The template declares
  `data-tt-node="gallery-media"` but `Gallery` never spread `attrs`, so gutter,
  column and width rules - including the mobile one - never applied. The
  wrapper takes `attrs` now.
- **Gallery's prose ran the full 78rem grid at full ink** under a centred
  title, on a look whose brief is that the pictures lead.
- **Checklist rendered due dates and priorities as filled capsules**, which is
  database vocabulary; the reference uses small grey text and coloured text.

Still open from that pass, none of them verified fixed:

- **Project's properties are a coloured pill plus a dot-separated strip, not a
  key/value list** (blocking). This is a template-structure change, not CSS.
- Project shows an orphan checkmark under the first milestone, and its
  milestone dates are uppercase, letterspaced, bold and navy.
- Checklist: separators are inset on both sides rather than starting under the
  text; completion is stated three times (bar, percentage, "2 of 6");
  completed rows keep full-strength colour chips; light mode uses Apple's
  dark-mode blue and the title colour is hardcoded so `--tt-accent` is
  decorative there.
- Bookmark's exemplar title carries a typewriter apostrophe.

### Page is the Notion look. Project never was.

Project was mapped to "the Notion look" and retuned. That was wrong, and no
amount of CSS was going to fix it: Project is a dashboard - a progress bar, a
dotted timeline, a callout box - and the reference is a cover, an icon, a
name, and then nothing but what you wrote. The structure was the mismatch, not
the styling.

`texttext.page` is built from the reference: full-bleed cover, an emoji icon
half over its bottom edge, a 40px left-aligned title, 16px/1.5 body, and one
left edge shared by the icon, the title and every block. No rules, no boxes,
no widgets. Project stays in the catalogue as the dashboard it actually is.

Checklist is **Tasks** now, and lost its progress bar: a bar, a percentage and
the checklist's own "2 of 6" rollup all stated one fact and pushed the first
task below the fold.

### An agent really can author a look, and could not before

`customize_document_template` and the per-workspace `documentTemplates` table
already existed. Writing `ai-authored-looks.test.ts` against them found that
they did not work for the case that matters.

`applyTemplateOperations` revalidated the whole template **after every single
operation**. Re-skinning a look means swapping its fields and the layout that
reads them, and no ordering of that is legal under per-step validation:
dropping a field breaks the layout still bound to it, and installing the
layout first binds fields not yet declared. Validation now runs once at the
end of the batch. Nothing is loosened - the rebuild still validates the entire
artifact before it can render, and operations are still capped at 32.

The test proves the whole path: an agent's operations derive a Todoist-shaped
board from Tasks, the base is left untouched, the result renders as a real
document, markup/CSS/script are refused by the schema, a binding to an
undeclared field is refused by the rebuild, and a workspace template cannot
squat on a reserved `texttext.` id.

## Open

Nothing from today's list. Two notes for whoever picks this up:

- The editor's focus ring tints the whole field with the look's accent at 7%,
  which is heavier over a tall body than it was over a one-line title. It is
  the accessibility affordance working as designed, but it is worth a look.
- `MarkdownSurface` adds two React Compiler "memoization could not be
  preserved" lint errors, inherent to building DOM imperatively in an effect.
  `npx eslint src` reports 26 against `main`'s 27.

## Verification

Local Postgres (`texttext_dev`). No production Neon, no deploy, no release, no
scheduled anything.

- `npx tsc --noEmit` clean.
- `npx vitest run`: 763 tests passing.
- `npm run build` succeeds.
- `npm run eval:collaboration:browser`: 24/24.
- `npx eslint src`: 26, against `main`'s 27.
- `swift build --package-path mac` clean; `swift test --package-path mac`: 413
  tests, 0 failures.
- The client launched against a local server end to end: origin resolved to
  `http://localhost:3000 (dev build, no release feed)` and the window stayed
  up.

## Next concrete step

Review against the screenshots and land with `merge-gate` from the worktree
(`~/dev/stack/runbooks/workflow.md`). Then take the editor migration on its own
branch.
