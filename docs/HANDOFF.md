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

## Next concrete step

Review against the screenshots and land with `merge-gate` from the worktree
(`~/dev/stack/runbooks/workflow.md`). Then take the editor migration on its own
branch.
