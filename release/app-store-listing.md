# App Store listing — TextText (app 6800104777, MAC_OS)

Draft of every storefront field, for your edit. Nothing here is submitted; the
values below are what I would set via `asc` on your say-so. The voice follows
the product's own landing page ("Everything you write, in one place") rather
than app-store hyperbole, which is both truer and less likely to draw a
metadata rejection.

Two lengths matter: **subtitle 30 chars**, **keywords 100 chars total** (one
comma-separated string, no spaces after commas to save room), **promotional
text 170**, **description 4000**.

---

## Name (set)
`TextText - AI Text Editor`  — already live on the record.

## Subtitle (30 max)
`Notes, articles, bookmarks` (26)

Alternatives, all within 30:
- `Write, shape, publish anywhere` (30)
- `One place for everything you write` — 34, too long
- `Your notes, articles and links` (30)

## Promotional text (170 max, editable without review)
`Create an item, choose how it looks, and publish it with a link when it is
ready. Bring your own AI to reshape and edit. Your writing stays portable
Markdown.` (156)

## Keywords (100 max, comma-separated, no trailing spaces)
`notes,writing,markdown,blog,bookmarks,editor,publish,read later,article,journal,AI writing,knowledge`
(99) — count it before setting; drop the last term if `asc` rejects length.

Rationale: no term repeats the app name or subtitle (Apple ignores those), and
none makes a claim the app cannot back ("free", "best"). "read later" and
"bookmarks" target the Raindrop-style use; "markdown" and "portable" are real
differentiators.

## Description (4000 max)
```
TextText is one place for everything you write: quick notes, long articles,
and the links you save to read later.

Create an item first and decide what it is later. Type a thought, paste a link,
or bring in an answer from an AI assistant, and it is saved as you go. Then
choose a look - a clean note, a published article, a bookmark, a gallery, a
to-do list - without moving your words into a different app. The same writing
can be reshaped from one form into another whenever you change your mind.

Bring your own AI. Connect your Anthropic or OpenAI key and an assistant can
draft, reshape, and edit alongside you. TextText does not sell AI usage or mark
it up; you use your own account, billed by your provider, and nothing is sent
anywhere until you ask.

Publish when you are ready. Any item can become a public page at its own link,
and everything else stays private by default - notes and bookmarks are never
listed. Share a document for editing, or keep it to yourself.

Your writing stays yours. Every document is portable Markdown you can export at
any time. The Mac app keeps your documents in Finder as real files through a
File Provider, so a copy is always on your disk, and you can delete your account
and everything in it from inside the app whenever you want.

- Notes, articles, bookmarks, galleries and more, from one content model
- Bring-your-own AI assistant (Anthropic or OpenAI), never resold
- Publish any item to a public link; private by default
- Real Markdown files on your Mac, always exportable
- Sign in with Apple, Google, or an emailed link
```
(within 4000)

## Copyright
`2026 Ramine Darabiha`

## Content rights declaration
`DOES_NOT_USE_THIRD_PARTY_CONTENT`
Correct as stated: the app hosts the user's own writing. If bookmark capture
that rehosts third-party article text is considered third-party content in the
app's own listing (it is the user's saved copy, not shipped in the binary),
this stays DOES_NOT — the declaration is about content in the app you ship, not
user-generated content.

## Primary category
`PRODUCTIVITY` (set). Secondary: consider `UTILITIES` — optional, leave unset
if unsure.

## Age rating
All content descriptors NONE. Three that need a real answer, not a blanket:
- User-generated content: **YES** - people publish public pages. This raises
  the rating to 17+ unless moderation is declared. The Report link now exists
  (Guideline 1.2), which is the moderation the questionnaire asks about.
- Unrestricted web access: **NO** - the app is not a browser; external links
  open in the user's real browser, there is no in-app open web surface.
- Contests / gambling / etc: NONE.

The 17+ that UGC forces is normal for any app with public user content and is
not a problem; it just has to be declared honestly.

## What's New (first version)
`First release of TextText for Mac.`

## Support URL (set)
`https://texttext.app/support`

## Privacy policy URL (set)
`https://texttext.app/privacy`

## Marketing URL (optional)
`https://texttext.app`

---

## What I can set with `asc` once you approve
description, keywords, promotional text, subtitle, marketing URL, whats-new,
copyright, content-rights, secondary category. Screenshots need capture from
the real app (I can do that once there is a running build to shoot). The age
rating questionnaire I can set via `asc age-rating edit`, but the three
judgement answers above are yours to confirm first.
