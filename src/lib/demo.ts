// Zero-setup demo content: with no DATABASE_URL the app serves this seed blog,
// so `npm run dev` shows the full product (list + reader) immediately.
// The demo tenant lives at http://demo.localhost:3000 (or /t/demo).

import type { Blog, Post } from "./content";

export const DEMO_BLOG: Blog = {
  handle: "demo",
  name: "The Demo Broadsheet",
  author: "The Editor",
  tagline: "Writing on product, AI, and craft.",
  accent: "#065ec6",
  bioLine: "Writing on product, AI, and craft.",
};

export const DEMO_POSTS: Post[] = [
  {
    type: "project",
    slug: "signal-desk",
    title: "Signal Desk",
    kicker: "Project",
    accent: "#1b7f5a",
    date: "2026-07-03",
    status: "published",
    gallery: [
      {
        src: "https://picsum.photos/seed/signal-desk-board/1200/800",
        caption: "The project dashboard balances dense status with clear editorial rhythm.",
      },
      {
        src: "https://picsum.photos/seed/signal-desk-flow/1200/800",
        caption: "Workflow views keep review, notes, and launch state in one scan.",
      },
      {
        src: "https://picsum.photos/seed/signal-desk-detail/1200/800",
        caption: "Detail pages reserve space for decisions instead of decorative chrome.",
      },
    ],
    links: [
      { label: "Prototype", href: "https://example.com/signal-desk" },
      { label: "Source notes", href: "https://example.com/signal-desk/notes" },
    ],
    body: `Signal Desk is a compact workspace for product teams that need to turn research into shipping decisions without losing the editorial trail.

## What it explores

The interface treats every decision as a small published object: context, evidence, owner, and next review. The goal is not more process. It is a calmer record that can be scanned by a human or an agent before the next build.`,
  },
  {
    type: "article",
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
    type: "talk",
    slug: "designing-quiet-ai-tools",
    title: "Designing quiet AI tools",
    kicker: "Talk",
    accent: "#8a5a00",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    venue: "WriteConf Studio",
    duration: "18 min",
    date: "2026-06-30",
    status: "published",
    body: `This talk looks at how writing tools can make agentic help feel present without making the interface louder.

## The core idea

AI should earn space in the editor by preserving intent. The useful parts are often small: a clean summary, a precise diff, a draft that keeps the author's cadence, or a warning when a claim needs evidence.

The design work is deciding what should stay quiet until the writer asks for it.`,
  },
  {
    type: "article",
    slug: "hello-world",
    title: "A quiet hello",
    kicker: "Meta",
    date: "2026-06-28",
    status: "published",
    body: `This is the smallest possible post: a paragraph or two, no cover, no sections. The reader should still feel finished, because the type is the design.

If this page looks good, everything else will.`,
  },
  {
    type: "article",
    slug: "notes-on-a-small-tool",
    title: "Notes on a small tool",
    kicker: "Draft",
    accent: "",
    date: "2026-07-02",
    status: "draft",
    body: `A good editor should make the next sentence feel near. The chrome can be precise, but it should never become the point.

## What this draft is for

This seed post keeps the Drafts folder honest while the product is still demo-backed. It is short enough to edit quickly and plain enough to show the neutral reader state.`,
  },
];
