// Zero-setup demo content: with no DATABASE_URL the app serves this seed blog,
// so `npm run dev` shows the full product (list + reader) immediately.
// The demo tenant lives at http://demo.localhost:3000 (or /t/demo).

import type { Blog, Post } from "./content";

export const DEMO_BLOG: Blog = {
  handle: "demo",
  name: "Matter & Method",
  author: "Mina Park",
  tagline: "Product, design, and craft for people who make software worth reading.",
  accent: "#0f766e",
  bioLine:
    "Mina Park writes about product systems, design detail, and the editorial craft of software.",
  cardStyle: "cover",
  homeLayout: "cards",
};

export const DEMO_POSTS: Post[] = [
  {
    type: "article",
    slug: "why-a-broadsheet",
    title: "Why a Broadsheet Still Works",
    excerpt:
      "A publication layout gives product writing the authority, pace, and restraint it deserves.",
    cover: "/covers/cover-010.jpg",
    coverCaption:
      "A quiet work surface makes room for hierarchy, evidence, and a little patience.",
    accent: "#0f766e",
    date: "2026-07-03",
    status: "published",
    pinned: true,
    body: `The fastest way to make a product essay feel disposable is to treat it like a feed item. Product writing needs room for argument, evidence, and a visible sense of care. A broadsheet layout does that without asking the interface to perform.

## Start with pace

**The headline earns the room.** A large title is not decoration when the page is asking someone to slow down. It tells the reader that the piece has shape, that the next few minutes are intentional, and that the author has done enough editing to make the visit worthwhile.

The supporting structure matters just as much:

- Put the dek close enough to the title that it reads as a promise.
- Keep date, author, and reading time visible but quiet.
- Let covers and inline figures widen the measure when the argument needs air.
- Use color as punctuation, not as wallpaper.

> A reading surface should make the strongest version of the text feel inevitable.

![A wide landscape gives the article a pause before the next section.](/covers/cover-014.jpg)

## Let structure carry feeling

**Restraint is not a lack of personality.** In a good reader, the personality comes from proportion, sequence, and the confidence to leave some surfaces alone. The cover can be cinematic. The body can stay calm. The quote can feel like a hinge. The bullet list can interrupt the rhythm without sounding like a checklist.

That rhythm matters for design writing because the subject is usually mixed. A single piece might include a product decision, a research note, a naming problem, and a shipped detail. The reader needs enough visual grammar to understand those turns without being told what each turn means.

## Design for the next pass

**Good publishing tools anticipate revision.** The same layout has to hold a short update, a long essay, a launch note, and a portfolio case study. It has to survive light and dark themes, a sparse cover, a strong accent, a clipped excerpt, and a paragraph that gets better after the author returns to it.

The broadsheet still works because it is not nostalgic. It is a compact system for making text feel considered. For a product called Write, that is the right starting point.`,
  },
  {
    type: "project",
    slug: "signal-desk",
    title: "Signal Desk",
    excerpt:
      "A compact product-review workspace that turns research, decisions, and launch notes into one editorial surface.",
    cover: "/covers/cover-001.jpg",
    coverCaption:
      "The workspace is designed around review, not dashboard theater.",
    accent: "#1b7f5a",
    date: "2026-07-02",
    status: "published",
    gallery: [
      {
        src: "/covers/cover-001.jpg",
        caption:
          "The review table keeps the next decision close to the evidence.",
      },
      {
        src: "/covers/cover-002.jpg",
        caption:
          "A focused writing mode leaves only status, owner, and revision notes in view.",
      },
      {
        src: "/covers/cover-004.jpg",
        caption:
          "Mobile checks are treated as editorial review, not a separate ritual.",
      },
      {
        src: "/covers/cover-010.jpg",
        caption:
          "The final handoff reads like a brief, with open questions still visible.",
      },
    ],
    links: [
      { label: "Method note", href: "/t/demo/field-guide-to-durable-defaults" },
      { label: "Launch essay", href: "/t/demo/why-a-broadsheet" },
    ],
    body: `Signal Desk is a prototype for teams that make product decisions in writing. It brings research excerpts, review state, launch notes, and owner decisions into a single editorial workspace so the record is useful after the meeting ends.

## Brief

**The design problem.** Product teams already have dashboards for status and documents for thinking. The gap is the space between them, where a decision needs evidence, context, and a next review date without becoming another process artifact.

Signal Desk treats each decision as a small published object. The object has a short title, a current stance, source notes, and a plain-language reason. The interface stays compact because the team needs to scan it every week.

## What changed

The prototype moved three patterns out of the way:

- Status lives next to the decision, not in a separate report.
- Research is quoted in short evidence cards, then linked back to the source.
- Launch notes are drafted from the decision trail, so the public story stays honest.

The result is not a louder dashboard. It is a calmer record of why the team chose the thing it chose.`,
  },
  {
    type: "article",
    slug: "field-guide-to-durable-defaults",
    title: "A Field Guide to Durable Defaults",
    excerpt:
      "The strongest defaults are less about taste than about removing future negotiation.",
    cover: "/covers/cover-012.jpg",
    coverCaption:
      "Durable defaults feel like a path through complexity, not a locked gate.",
    accent: "#366c4f",
    date: "2026-06-29",
    status: "published",
    body: `Defaults are where a product quietly states its values. They decide what gets named, what gets saved, what gets shared, and how much cleanup a person has to do before the work feels presentable.

## Every default is a sentence

**A default tells the user what kind of place they are in.** A writing tool that opens with a loud template says the tool knows better than the writer. A tool that opens with a blank white square says nothing at all. The useful middle is a default that gives enough shape to begin and enough silence to think.

Good defaults tend to do four things:

- Preserve the user's intent before asking for organization.
- Name objects in language a person would use in a conversation.
- Keep destructive choices away from casual clicks.
- Make the next likely action visible without making it mandatory.

> The best default is not the one everyone keeps. It is the one nobody has to fight.

![A river path makes a useful metaphor for defaults that guide without trapping.](/covers/cover-016.jpg)

## Spend attention where it compounds

**Small decisions become product culture.** If every new article starts as "Untitled," the product is saying naming can wait. If every cover falls back to something handsome and calm, the product is saying unfinished work can still be handled with dignity. Those choices change how the writer feels about returning tomorrow.

Durable defaults are also practical. They reduce support cost because fewer people get stuck at the first step. They reduce design debt because the system has fewer special cases. They reduce editorial cleanup because published work starts closer to finished.

## Defaults should be revisited

**A durable default is not permanent.** It earns its place by continuing to fit the product's current audience. When the product grows, the defaults should be audited with the same seriousness as navigation or pricing.

The question is simple: does this choice help a thoughtful person move forward, or does it merely protect the product from ambiguity? If the answer is the second one, the default needs another pass.`,
  },
  {
    type: "talk",
    slug: "living-with-complexity",
    title: "Living With Complexity",
    excerpt:
      "Don Norman's Stanford talk is a useful reminder that product design should help people manage complexity instead of pretending it is gone.",
    cover: "/covers/cover-014.jpg",
    accent: "#8a5a00",
    videoUrl: "https://www.youtube.com/watch?v=flRuSn0df8Q",
    venue: "Stanford University",
    duration: "1 hr",
    date: "2026-06-25",
    status: "published",
    body: `A useful design talk for anyone making writing tools, editorial systems, or AI-assisted product surfaces. Norman's argument is not that complexity should disappear. It is that complexity should be organized so people can build a reliable mental model.

## Why it belongs here

**The lesson travels well.** Modern software often hides complexity until the moment a user needs to make a precise choice. That can feel simple at first and brittle later. Good tools keep the system understandable even when the work has many states.

For Write, that means drafts, covers, galleries, video, status, feeds, and editing controls need to feel like one coherent place. The interface can be quiet, but it should never be evasive.`,
  },
  {
    type: "article",
    slug: "the-empty-state-is-editorial",
    title: "The Empty State Is Editorial",
    excerpt:
      "A blank canvas is not empty. It is the first promise a tool makes to its user.",
    cover: "/covers/cover-004.jpg",
    coverCaption:
      "The first screen should reduce doubt before it asks for commitment.",
    accent: "#6f4f1f",
    date: "2026-06-18",
    status: "published",
    body: `The empty state is the first editorial surface in a product. Before a person writes a title, uploads a cover, or chooses a format, the product has already said something about what kind of work belongs there.

## Name the next move

**People do not need a motivational poster.** They need a clear place to start and a sense that the product will respect the work once it exists. The strongest empty states are brief, specific, and shaped by the object that will appear there.

For a publishing tool, that means the first state should answer practical questions:

- What can I make here?
- Will the work be private until I publish it?
- What parts can I add later?
- Is this tool going to impose a voice on me?

> Empty states are not onboarding. They are the first draft of the relationship.

![A notebook beside a device keeps the focus on beginning, not configuring.](/covers/cover-001.jpg)

## Leave room for confidence

**The best empty state disappears without regret.** It should be helpful before content exists and irrelevant the moment content arrives. That is a high bar because it asks the product to be generous without becoming clingy.

This is where editorial discipline helps. Write one sentence. Make the action obvious. Keep secondary choices nearby but visually quiet. Do not explain the whole product. The user came to make something, and the interface should return that attention as quickly as possible.

## The first saved object matters

**A new object should look cared for immediately.** A fallback cover, a readable title, a clean date, and a stable URL all tell the author the product will hold the work properly. Even unfinished work deserves a frame that makes returning feel easy.

That small promise is the craft of an empty state: begin here, leave when ready, and come back to something that still makes sense.`,
  },
];
