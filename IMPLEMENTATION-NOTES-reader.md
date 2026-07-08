# Reader implementation notes

## Scope

Files changed:

- `src/components/Reader.tsx`
- `src/components/TalkReader.tsx`
- `src/components/ProjectReader.tsx`
- `src/styles/broadsheet.css`
- `src/styles/talk.css`
- `src/styles/project.css`

Verification:

- `npx tsc --noEmit` passed.
- No dev server was started.
- No token files were changed.

## Issues and fixes

### Public readers were forced to light tokens

Issue: `.reader` and `.project-split` reset ink, muted, background, and hairline variables to light values. That made article, talk, and project reader color checks meaningless in dark mode.

Fix: Kept landing and blog home light, but changed `.reader` and `.project-split` to inherit the active theme tokens. Reader body backgrounds now use `var(--bg)` and `var(--ink)`.

Light check: `--ink` on `--bg` is 16.83:1, `--ink-2` on `--bg` is 10.01:1, `--muted` on `--bg` is 5.07:1.

Dark check: `--ink` on `--bg` is 16.83:1, `--ink-2` on `--bg` is 11.39:1, `--muted` on `--bg` is 8.03:1.

Token recommendation: none.

### Link focus was not visible enough

Issue: Article prose links and talk resource links had hover styling but no explicit `:focus-visible` treatment.

Fix: Added focus-visible outlines using the existing floored accent pattern mixed toward ink. Link text remains `color-mix(in srgb, var(--post-accent) 60%, var(--ink))`.

Light check: tested floored links with `#0066cc`, `#065ec6`, `#7c3aed`, and `#d28314`; worst case was `#d28314` at 5.90:1 on `--bg` and 5.42:1 on `--bg-soft`.

Dark check: worst tested floored link was `#065ec6` at 6.05:1 on `--bg` and 7.55:1 on `--bg-soft`.

Token recommendation: none.

### White overlay controls failed on bright media

Issue: Public article/project navigation used white icons over a 45 percent black overlay. On a white image, that composites to 3.36:1, below the reader floor.

Fix: Raised the default overlay to 62 percent black and hover/focus to 74 percent black for public post and project carousel nav controls. Added visible focus rings.

Light check: white icon over 62 percent black composited on a white image is 6.19:1. Hover/focus at 74 percent is 10.05:1.

Dark check: over dark media or the dark lightbox surface, white icon contrast is at least as strong as the light worst case.

Token recommendation: none. A future shared overlay-control token could reduce duplicated rgba values, but no token change is required for this fix.

### Markdown body could introduce another `h1`

Issue: Reader markdown could render `# Heading` as an `h1` inside pages that already have a page title `h1`.

Fix: Mapped markdown `h1` to `h2` in article, talk, and project readers. Default rendered titles now have stable IDs, and default article/talk wrappers use `aria-labelledby`. Project no longer points `aria-labelledby` at a missing ID when a title slot is supplied.

Light check: no color change.

Dark check: no color change.

Token recommendation: none.

### Inline image captions duplicated alt text for assistive tech

Issue: Markdown image alt text is also rendered as the visible caption, so assistive tech could hear the same text twice.

Fix: Kept the image alt text and marked the duplicate visible caption `aria-hidden`.

Light check: caption text remains `--muted` at 5.07:1 on `--bg`.

Dark check: caption text remains `--muted` at 8.03:1 on `--bg`.

Token recommendation: none.

### Footnotes were not explicitly in the reader measure

Issue: GFM footnotes inherited prose color but did not have explicit reader measure, rule, or heading styling.

Fix: Added `[data-footnotes]` reader styling with the same 680px measure, token hairline, `--ink-2` body text, and `--ink` heading text. Talk and project readers override the measure to fit their narrower layouts.

Light check: footnote body text uses `--ink-2` at 10.01:1 on `--bg`; footnote headings use `--ink` at 16.83:1.

Dark check: footnote body text uses `--ink-2` at 11.39:1 on `--bg`; footnote headings use `--ink` at 16.83:1.

Token recommendation: none.

### External talk links lacked `noopener`

Issue: Talk links opened in a new tab with `noreferrer` but not `noopener`.

Fix: External talk links now use `rel="noopener noreferrer"`.

Light check: no color change.

Dark check: no color change.

Token recommendation: none.

### Project reader had extra motion outside the cover reveal

Issue: The project carousel had a load-time nav peek and an infinite skeleton pulse. These exceeded the reader motion rule.

Fix: Removed the CSS effect of the nav peek, removed the skeleton pulse, and disabled reader control transitions under `prefers-reduced-motion: reduce`.

Light check: no contrast regression. Carousel captions use `--ink` at 16.83:1 on `--bg`.

Dark check: no contrast regression. Carousel captions use `--ink` at 16.83:1 on `--bg`.

Token recommendation: none.

Non-token follow-up: `src/components/ProjectGallery.tsx` still contains JS autoplay and video `autoPlay`, but that file is outside the allowed edit list for this task. The recommended follow-up is to disable carousel auto-advance and video autoplay when `prefers-reduced-motion: reduce` matches.
