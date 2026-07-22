# Texttext: the design contract

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

## Shared rules

- No em dashes anywhere in product copy or docs (hard rule).
- Both themes always: every color decision must be checked on light and dark.
- Sentence-case UI copy, verb-first buttons, no exclamation marks.
- Taste over decoration. When unsure, remove.
