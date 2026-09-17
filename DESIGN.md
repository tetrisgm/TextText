# TextText: the design contract

Two design systems, one product. Both were built and shipped on an earlier site
first; this file is the portable contract so they survive the move.

## 1. The Broadsheet (the published blog)

The reading experience. One display serif (Fraunces SemiBold) sets the
headline, eyebrow, section marks, and end matter over the body face (Inter,
an SF-alike; Macs effectively see the same rhythm as SF Pro). The words are
the design.

**The accent rule.** Every post carries one color (its own, or the blog's).
The accent never floods a surface and never colors body text. It survives only
as hairline-weight structural signals:

- the 2px rule under the eyebrow
- the 40px tick above an h2 (dropped on the first h2)
- the spine and 6% plate of a pull-quote
- the 1px frame hairline and shadow tint on the cover
- the dot before a "**Lead-in.** body" paragraph
- the avatar fill (decorative, aria-hidden)
- the 22% tinted text selection

**The contrast rule (non-negotiable).** Accent as TEXT must be floored:
`color-mix(in srgb, var(--post-accent) 60%, var(--ink))`. Mixing toward the
theme's own ink flips correctly between light and dark and clears WCAG AA
(measured >= 5.9:1 for #065ec6, #7c3aed, #d28314 on both themes). Raw accent
as text fails AA in one theme for essentially every hue. Decorative,
aria-hidden marks may use the raw accent.

**The motion rule.** The static state is always the finished state. One gated
reveal exists (the cover, under `prefers-reduced-motion: no-preference`);
nothing else moves on load. Never ship an entrance that rests at opacity 0
without a reduced-motion force-visible fallback.

**The measure.** Text in a 680px column; inline figures step out to 880px;
the cover to 1000px. The width difference IS the layout.

**Degradation.** `--post-accent` may be unset. Every accent use must fall back
to a neutral token (`--ink`, `--muted`, `--hairline`, `--bg-soft`). A post
with no color must look deliberately monochrome, not broken.

## 2. The Apple editor (`.applecms`, src/styles/apple.css)

The writing experience: Apple HIG fidelity, modeled on Apple Notes' 3-column
chrome (folders | list | editor). iOS system colors light + dark, SF type
scale with per-size tracking, 8pt spacing grid, 6px macOS control radii,
chrome material via backdrop-filter with a solid fallback. System font stack
only, never a webfont pretending to be SF Pro.

## 3. The Dashboard (the workspace Home)

The news surface: what arrived, from feeds and from your own work, presented
the way Artifact presented it. It lives inside the Apple chrome and keeps the
shell's sidebar and panels, but the reading area speaks its own vocabulary,
scoped to `src/components/workspace/home/Home.module.css` under `--news-*`.

The numbers below were measured off iPhone captures at 3x on a 393pt screen,
not chosen: cap heights were read from the pixels and divided by SF Pro's cap
ratio to recover a font size, calibrated against the 17pt status-bar clock.
`src/components/workspace/home/__tests__/artifact-contract.test.ts` holds the
proportions that survive, with their measurements, so a tidy-up cannot quietly
lose them.

**One strip, and it is the navigation.** For You, then the channels, then the
saved searches and the derived clusters, then a `•••` at the end for
everything that is not a subject. The tab text is the same size as a headline
(measured 52.5px against 52.5px), which is the single proportion that makes
this surface recognisable rather than generic. The chosen tab is marked by
ink alone: no pill, no underline, no dot, and no heavier weight, because a
heavier weight shifts every tab to its right as you move along the strip.
Publishers never appear in the strip.

**A channel is a set of sources.** `src/lib/reading/channels.ts` holds the
catalogue and places a new source from its host, then from the words in its
name, then not at all, because a wrong subject is worse than none. The channel
lives on the feed connection, so moving a publisher between channels is one
control on its row in Manage sources.

**Two sizes to a screen.** The feed uses the headline size and the metadata
size, and nothing else; roles are told apart by colour, never by scale. The
headline is semibold, the publisher name is one step lighter, the time beside
it is the same size and weight in secondary ink. The one display size is a
section title, about half again a headline, and it is used for a section, never
for a story.

**The list, not the card.** Items sit on one continuous surface separated by
hairlines, inset to the text gutter. No borders, no shadows, no rounded card
around a row, no coloured chrome. The only rounded rectangles are photographs
and the dashboard panels. A row has about one headline's worth of air above
and below it.

**Identity before the headline.** Every item opens with a mark, the publisher's
name, and the age. The mark is the site's own icon when it answers at the
conventional path and a monogram in a colour derived from the name when it does
not, so the row is never missing its anchor, and it outdents by two pixels so
its round corner sits optically on the text origin above and below. A feed that
names itself rather than the publisher (an aggregator) shows the linked site
and keeps its own name as "via". Feed titles are catalogue entries, so they are
tidied to the masthead a person would say: "World news | The Guardian" is The
Guardian.

**Photographs get real size, on a rhythm.** A full-width 16:9 image every third
item at most, square thumbnails otherwise, and never on the first item: the
original opens on two compact rows and then a picture. The thumbnail is
vertically centred against the text it sits beside, so it recentres as a
headline wraps. Aspect ratios are declared so nothing shifts as images arrive.

**Headlines is a module, not a filter of the page.** The stories more than one
source is covering, chosen across the whole window and lifted out of the list
so they are never shown twice, as a strip of fixed-width cards that overflows
with the next one peeking. Below two stories there is no strip: one card is not
a strip, and the stories read perfectly well in the list.

**Colour is furniture, never text.** The brand tones appear in section labels
and dashboard panels. Body text and headlines are ink. Every `--news-*` colour
is measured against both grounds in `contrast.test.ts` and clears AA in both
themes, which is the one place the port refuses the original's own value: its
secondary ink sat on pure black and ours does not.

**The rail is the command centre.** The desk's last few items and the articles
kept to read. On a phone-width window the rail moves below the news, because a
news Home whose news starts below the fold is not one.

## Shared rules

- No em dashes anywhere in product copy or docs (hard rule).
- Both themes always: every color decision must be checked on light and dark.
- Sentence-case UI copy, verb-first buttons, no exclamation marks.
- Taste over decoration. When unsure, remove.
