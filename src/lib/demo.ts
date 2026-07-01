// Zero-setup demo content: with no DATABASE_URL the app serves this seed blog,
// so `npm run dev` shows the full product (list + reader) immediately.
// The demo tenant lives at http://demo.localhost:3000 (or /t/demo).

import type { Blog, Post } from "./content";

export const DEMO_BLOG: Blog = {
  handle: "demo",
  name: "The Demo Broadsheet",
  author: "Ramine Darabiha",
  tagline: "Writing on product, AI, and craft.",
  accent: "#065ec6",
  bioLine: "Writing on product, AI, and craft.",
};

export const DEMO_POSTS: Post[] = [
  {
    slug: "why-a-broadsheet",
    title: "Why your blog should read like a broadsheet",
    kicker: "Design notes",
    accent: "#065ec6",
    date: "2026-07-01",
    status: "published",
    body: `Most blog themes decorate the chrome and neglect the text. This platform inverts that: one display serif sets the headline, the eyebrow, and the section marks, and everything else gets out of the way of the words.

## The accent is a signal, not a paint bucket

Every post carries one color. It never floods a background and it never colors body text. It survives only as hairline-weight marks: the rule under the eyebrow, the tick above a section, the spine of a pull-quote, the frame around a cover.

> The static state is always the finished state. If the design needs motion to look complete, the design is not complete.

**Contrast is not negotiable.** Whenever the accent touches text, it is floored toward the theme ink so every hue clears WCAG AA in light and dark. Decoration can be colorful; reading can not be compromised.

**The measure does the work.** Text sits in a 680px column. Media steps out wider. That difference in width is the layout.

## Built for the next reader too

Posts are markdown all the way down, with real semantics: headings, quotes, figures with captions. That makes every post as legible to an agent as it is to a person, which is the point.`,
  },
  {
    slug: "hello-world",
    title: "A quiet hello",
    kicker: "Meta",
    date: "2026-06-28",
    status: "published",
    body: `This is the smallest possible post: a paragraph or two, no cover, no sections. The reader should still feel finished, because the type is the design.

If this page looks good, everything else will.`,
  },
];
