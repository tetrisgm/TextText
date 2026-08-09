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

## Open

**The body is a plain textarea over Markdown.** You type `##` and see `##`
while the reader sees a heading. This is the one item on today's list that is
not fixed. It was attempted and backed out, and the attempt is worth reading
before the next one.

What was built: `MarkdownSurface`, a `contentEditable="plaintext-only"` surface
rendering the source itself as styled inline spans, with newlines as literal
characters so `textContent` stayed byte-for-byte the source. That last decision
matters and should be kept: rendering one block element per line makes
`textContent` silently drop every newline, and puts remote-caret offsets out by
one per line. Only the body changed; title and subtitle kept the textarea they
were proved on.

It worked for content. Every content check stayed green: typing propagated both
ways, an agent's writes still landed live, the three-way merge still lost
nothing. The Markdown genuinely rendered: headings at heading size with the
`##` receded, emphasis as emphasis.

It was backed out for selection. React owns the styled markup, so the caret has
to be restored after every re-render, and the restore collapses a range to a
single point. The presence poll re-renders roughly every 1.2 s, so a colleague's
caret arriving would wipe whatever the local writer had selected, mid-drag. The
live run caught it: `Ada insertion point after: -1`, and the two caret checks
went red while the content checks stayed green.

A second attempt fixed the selection-collapse (restore only when the text
changed, keep anchor AND head, key segments by source offset so an unchanged
text reconciles without replacing the nodes the selection lives in, and skip
restoration during composition and during a pointer drag). It still did not
pass. The caret probe read `-1` on every run: no DOM Selection inside the
surface at all, while typing appeared to work.

That is where it was left, and the honest position is that the cause is not
established. Two candidates, in order of likelihood:

1. `contentEditable="plaintext-only"` may not be honoured in the harness's
   Chromium build, leaving the element neither editable nor focusable. This is
   testable in one line: assert `document.activeElement` is the surface right
   after a click.
2. A DOM Selection only exists while the document has focus, unlike a
   textarea's `selectionStart`, which survives losing it. `page.bringToFront()`
   did not change the reading, so this is the weaker candidate, but it is not
   ruled out.

What the second attempt DID establish, and what was kept:

The run could pass on text a PREVIOUS run left in the same document. It reuses
its two dev-login accounts and reopens the same draft, and every assertion used
a fixed string, so a check could go green while the editor it was meant to
exercise did nothing. Every assertion is stamped per run now
(`LIVE_COLLAB_RUN`, defaulting to the pid). The 24/24 that follows is therefore
a real 24/24, and this class of false pass cannot recur. Establishing that was
worth the attempt on its own.

What a third attempt needs, in order:

1. Assert the surface is focusable and focused before anything else. That
   single check separates candidate 1 from candidate 2 and was the missing
   rung both times.
2. Only then judge the selection work, which is already written down above and
   believed correct.

The `Y.XmlFragment` route remains the other option: the extensions are all still
in the repo (`SlashCommand.ts`, `WikiLink.ts`, `tiptap-suggestion.ts`,
`@tiptap/extension-collaboration-cursor`). It changes the collaborative shape of
the body, which every consumer of `documentText(doc, "body")` depends on:
materialization, the agent caret helpers, the sync projection, and every stored
`collab_state` baseline. It needs a migration and its own tests.

Either way, the rule the live run enforces is the useful one: content checks and
caret checks must BOTH stay green. A writing surface that keeps the words and
loses the cursor is not an improvement.

Everything else on today's list is fixed. The two assistant items were the last
of it: the composer now carries the open item's title, the exact selection and a
bounded opening of the body, so a request about "this document" no longer
reaches the provider as an id with no text; and the quick-action proposal
producer is restored, so Title, Excerpt, Rewrite and Tags come back as something
you can apply and undo rather than text to copy by hand. Summarize deliberately
produces no proposal, because applying a summary over the text it summarises
would delete the document.

## Verification

Local Postgres (`texttext_dev`). No production Neon, no deploy, no release, no
scheduled anything.

- `npx tsc --noEmit` clean.
- `npx vitest run`: 763 tests passing.
- `npm run build` succeeds.
- `npm run eval:collaboration:browser`: 24/24.
- `npx eslint src`: 24 errors, all pre-existing. `main` has 27.

## Next concrete step

Review against the screenshots and land with `merge-gate` from the worktree
(`~/dev/stack/runbooks/workflow.md`). Then take the editor migration on its own
branch.
