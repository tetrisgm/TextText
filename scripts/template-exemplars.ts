// One genre-faithful exemplar per built-in template.
//
// These are the documents the showcase publishes and screenshots. Each is
// written to the standard of the app its genre comes from: the recipe should
// read like Paprika or a good cookbook card, the changelog like
// keepachangelog.com, the to-do like Things, the bookshelf like a Literal or
// Goodreads log, the postmortem like a real incident review. Filler here
// would defeat the point: the question under test is whether the engine can
// carry real content with the fidelity of the dedicated apps.
//
// Field ids MUST match src/lib/presentation/templates.ts exactly; the
// showcase fails loudly if the server rejects a value.

export type Exemplar = {
  template: string;
  title: string;
  body: string;
  fields: Record<string, unknown>;
};

export const EXEMPLARS: Exemplar[] = [
  {
    template: "texttext.article",
    title: "The case for slow publishing",
    body: `The internet rewards speed. Publish first, correct later, let the feed sort it out. This essay argues the opposite: that the writing worth reading in five years is the writing someone sat on for five weeks.\n\n## The cost of fast\n\nEvery editing pass you skip is a debt the reader pays. A rushed piece externalizes its confusion.\n\n## What slow buys\n\nTime is the only editor that works for free. A draft that survives three weekends of rereading has earned its claims.\n\nWrite fast. Publish slow.`,
    fields: {},
  },
  {
    template: "texttext.note",
    title: "Things I keep relearning",
    body: `- The bug is always in the code you were most sure about\n- Writing the summary first makes the meeting shorter\n- If a file needs a comment to explain its name, rename the file\n- Coffee after 3pm is a loan against tomorrow`,
    fields: {},
  },
  {
    template: "texttext.bookmark",
    title: "How Figma's multiplayer technology works",
    body: `Figma's engineering deep-dive on their multiplayer sync: client-side prediction, server-authoritative conflict resolution, and why they chose properties-last-writer-wins over OT. The section on undo in a multiplayer world is the best writing on the topic anywhere.`,
    fields: { sourceUrl: "https://www.figma.com/blog/how-figmas-multiplayer-technology-works/" },
  },
  {
    template: "texttext.gallery",
    title: "Fog season, Ocean Beach",
    body: `Six mornings in July, same dune, same hour. The fog does the composing.`,
    fields: {},
  },
  {
    template: "texttext.talk",
    title: "Simple made easy",
    body: `Rich Hickey's argument that simplicity is an objective property of code, distinct from ease, and that most of our tools optimize the wrong one. The talk that gave "complect" back to the language.`,
    fields: { videoUrl: "https://www.youtube.com/watch?v=SxdOUGdseq4" },
  },
  {
    template: "texttext.todo",
    title: "Launch week",
    body: `Everything that has to happen before Tuesday's announcement. Anything not on this list waits until Thursday.`,
    fields: {
      area: "work",
      items: [
        { task: "Freeze the release branch", done: true, when: "2026-07-27", priority: "high" },
        { task: "Final pass on the landing page copy", done: true, when: "2026-07-27", priority: "high" },
        { task: "Record the 90-second demo", done: false, when: "2026-07-28", priority: "high" },
        { task: "Draft the announcement post", done: false, when: "2026-07-28", priority: "medium" },
        { task: "Brief the beta list", done: false, when: "2026-07-29", priority: "medium" },
        { task: "Order pastries for launch morning", done: false, when: "2026-07-30", priority: "low" },
      ],
    },
  },
  {
    template: "texttext.meeting",
    title: "Pricing review",
    body: `## Discussion\n\nWalked the three models: flat monthly, usage tiers, and seat-based. Flat monthly wins on comprehensibility; usage punishes exactly the customers we want most. Seat-based deferred until teams ship.\n\nMarketing wants the price on the landing page. No objections.`,
    fields: {
      date: "2026-07-28",
      meetingType: "planning",
      attendees: "Ramine, Mina, Jordan",
      decisions: "Launch at a flat $8/month with a 30-day trial. Revisit seat pricing when team workspaces ship. Price goes on the landing page above the fold.",
      actions: [
        { item: "Update the pricing page", done: false, owner: "Mina", due: "2026-07-31" },
        { item: "Wire the trial expiry email", done: false, owner: "Jordan", due: "2026-08-04" },
        { item: "Grandfather the beta cohort", done: true, owner: "Ramine", due: "2026-07-29" },
      ],
    },
  },
  {
    template: "texttext.journal",
    title: "Tuesday, July 28",
    body: `Shipped the thing. The moment between pushing the button and the first real user hitting it is a specific kind of quiet.\n\nWalked to the bakery at four instead of having a third coffee. The queue was out the door and I stood in it anyway, which is either patience or avoidance.\n\nRead two chapters of Piranesi before bed. The house with the tides. I keep thinking about it.`,
    fields: { date: "2026-07-28", mood: "good", location: "home" },
  },
  {
    template: "texttext.bookshelf",
    title: "Piranesi",
    body: `A man lives in a house of infinite halls where the tides come in. To say more is to spoil the finest slow reveal in modern fiction. Clarke writes wonder without irony, which almost nobody can do.`,
    fields: {
      author: "Susanna Clarke",
      status: "finished",
      rating: 5,
      pages: 245,
      startedAt: "2026-07-10",
      finishedAt: "2026-07-24",
      moods: ["strange", "moving"],
      favoriteQuote: "The Beauty of the House is immeasurable; its Kindness infinite.",
    },
  },
  {
    template: "texttext.watchlist",
    title: "Perfect Days",
    body: `Wenders films a man who cleans Tokyo toilets and reads Faulkner, and somehow it is about everything. The komorebi shots alone justify the ticket.`,
    fields: {
      year: 2023,
      status: "watched",
      watchedAt: "2026-07-19",
      rating: 4.5,
      liked: true,
      rewatch: false,
    },
  },
  {
    template: "texttext.recipe",
    title: "Weeknight cacio e pepe",
    body: `The whole trick is the pasta water. Everything else is confidence.`,
    fields: {
      servings: 2,
      prepMinutes: 5,
      cookMinutes: 15,
      difficulty: "medium",
      rating: 5,
      ingredients: [
        { item: "200g spaghetti", have: true, section: "Pasta" },
        { item: "80g Pecorino Romano, finely grated", have: true, section: "Sauce" },
        { item: "2 tsp black peppercorns", have: true, section: "Sauce" },
        { item: "Flaky salt", have: true, section: "Sauce" },
      ],
      steps: [
        { instruction: "Toast the peppercorns in a dry pan until fragrant, then crush coarsely.", minutes: 3 },
        { instruction: "Cook the spaghetti in well-salted water to one minute shy of the package time. Reserve a full cup of pasta water.", minutes: 10 },
        { instruction: "Off heat, whisk the Pecorino with a splash of warm (not boiling) pasta water into a thick cream.", minutes: 2 },
        { instruction: "Toss the drained pasta with the pepper, then the cheese cream, loosening with pasta water until glossy. Serve immediately in warm bowls.", minutes: 2 },
      ],
    },
  },
  {
    template: "texttext.changelog",
    title: "Texttext 0.154",
    body: `The document-types release. Documents now have real shapes, built from typed fields and rendered by the engine.`,
    fields: {
      version: "0.154",
      date: "2026-07-29",
      releaseStatus: "released",
      breaking: false,
      changes: [
        { kind: "added", note: "Twenty-three built-in looks in six groups, from to-do lists to postmortems" },
        { kind: "added", note: "Typed fields you fill in right in the document: dates, ratings, statuses, checklists, repeating rows" },
        { kind: "added", note: "Folders sort and filter by your fields, so a bookshelf orders itself by rating" },
        { kind: "changed", note: "The create menu groups looks by what you are doing" },
        { kind: "fixed", note: "Edits typed in the first moment after creating a document are never lost" },
      ],
    },
  },
  {
    template: "texttext.decision",
    title: "Agents on this Mac use a CLI, not a local server",
    body: `## Context\n\nLocal AI agents need a way to read and edit workspace documents. The obvious pattern, a loopback MCP server on a fixed port, is what Paper ships. We ran it for three releases.\n\nA port any process can reach is also a port any web page can reach. A cross-origin POST with a text/plain body skips CORS preflight entirely; our server never checked Content-Type, so any site the user visited could write to their documents. We fixed that, then asked why we had a port at all.`,
    fields: {
      seq: 12,
      status: "accepted",
      decidedAt: "2026-07-29",
      deciders: "Ramine",
      options: [
        { option: "Harden the loopback server (auth, origin checks)", verdict: "rejected", because: "Mitigates the class instead of deleting it; every future change re-litigates the threat model" },
        { option: "Ship a CLI inside the app bundle", verdict: "chosen", because: "No port means no browser can reach it; the device credential makes it authenticated by construction" },
      ],
      outcome: "The texttext CLI shipped in 0.146 and the local server was deleted. Presence and audit attribution came free because the CLI knows who is working and why.",
    },
  },
  {
    template: "texttext.wiki",
    title: "How releases work",
    body: `## The one rule\n\nShip only a clean, verified main commit. The daemon does everything else.\n\n## The pipeline\n\n1. Commit a coherent unit to main\n2. Run the release gate on that exact commit\n3. Push. The launchd daemon notices, builds, signs, notarizes, publishes, and installs\n4. The daemon commits the release metadata itself\n\n## When it fails\n\nThe daemon holds a failing commit and releases the hold when a new commit lands. It never retries a deterministic failure in a loop, and it never ships a dirty tree.`,
    fields: {
      owner: "Ramine",
      pageStatus: "current",
      lastReviewed: "2026-07-29",
    },
  },
  {
    template: "texttext.spec",
    title: "Workspace templates v2",
    body: `## Problem\n\nUsers can pick from built-in looks but cannot yet save a customized look and reuse it across a workspace.\n\n## Non-goals\n\nNo user CSS or JavaScript. No template marketplace in this version.`,
    fields: {
      specStatus: "in-review",
      owner: "Ramine",
      targetDate: "2026-08-20",
      summary: "Let a workspace save customized templates as immutable versions and set one as a folder default.",
      requirements: [
        { requirement: "Customized template saves as a new immutable workspace version", priority: "must", done: true },
        { requirement: "A folder can pin any workspace template as its default", priority: "must", done: false },
        { requirement: "Template gallery shows workspace templates beside built-ins", priority: "should", done: false },
        { requirement: "Export a workspace template as a shareable file", priority: "could", done: false },
      ],
      openQuestions: [
        { question: "Do workspace templates sync to the Mac app gallery?", resolved: true, answer: "Yes, they ride the same pool payload." },
        { question: "Can a viewer-role member see workspace templates?", resolved: false, answer: "" },
      ],
    },
  },
  {
    template: "texttext.project",
    title: "Website relaunch",
    body: `Move the marketing site onto the document engine so the site is a workspace and every page is a document.`,
    fields: {
      status: "active",
      lead: "Ramine",
      due: "2026-08-15",
      milestones: [
        { milestone: "Design locked", due: "2026-08-01", reached: true },
        { milestone: "Content migrated", due: "2026-08-08", reached: false },
        { milestone: "DNS cutover", due: "2026-08-15", reached: false },
      ],
      tasks: [
        { task: "Audit current pages and traffic", done: true, owner: "Ramine", due: "2026-07-30" },
        { task: "Rebuild landing in the engine", done: false, owner: "Mina", due: "2026-08-05" },
        { task: "Redirect map for old URLs", done: false, owner: "Jordan", due: "2026-08-12" },
      ],
      risks: "The pricing page A/B test ends Aug 10; cutover before then means migrating the losing variant.",
    },
  },
  {
    template: "texttext.goals",
    title: "Q3 goals",
    body: `Three goals, deliberately few. The quarter is won on the first one.`,
    fields: {
      period: "Q3 2026",
      goalStatus: "on-track",
      owner: "Ramine",
      score: 0.45,
      keyResults: [
        { result: "Weekly active writers", current: 340, target: 1000, unit: "writers" },
        { result: "Documents created per week", current: 2100, target: 5000, unit: "docs" },
        { result: "Median editor load time", current: 380, target: 250, unit: "ms" },
      ],
    },
  },
  {
    template: "texttext.postmortem",
    title: "Sync outage, July 12",
    body: `## Summary\n\nFor 47 minutes, document saves from the Mac app returned 500s. Web editing was unaffected. No data was lost; the app's outbox retried every failed save successfully after recovery.`,
    fields: {
      incidentDate: "2026-07-12",
      severity: "sev2",
      durationMinutes: 47,
      impact: "Mac app saves failed for all users; web unaffected; zero data loss after outbox replay",
      timeline: [
        { time: "14:02", event: "Deploy 0.91 goes out with a migration that renames a column" },
        { time: "14:06", event: "Error rate on /api/sync/v1/files crosses 50%; alert fires" },
        { time: "14:15", event: "Rollback initiated; old code still references the renamed column" },
        { time: "14:31", event: "Forward-fix deployed restoring a compatibility view" },
        { time: "14:49", event: "Error rate back to baseline; outbox replays confirmed" },
      ],
      rootCause: "The migration renamed a column in the same deploy as the code that stopped using it. Rollback restored old code but not the old column, extending the outage. Expand-and-contract was documented but not enforced.",
      actionItems: [
        { item: "Gate: migrations may only add in the same deploy; removals wait one release", done: true, owner: "Ramine" },
        { item: "Alert on sync error rate at 10%, not 50%", done: true, owner: "Jordan" },
        { item: "Runbook for column-rename rollbacks", done: false, owner: "Mina" },
      ],
    },
  },
  {
    template: "texttext.retro",
    title: "Launch week retro",
    body: `Thirty minutes, everyone writes first, then we talk. Actions get owners or they get deleted.`,
    fields: {
      date: "2026-07-31",
      team: "Product",
      wentWell: [
        { item: "The demo video carried the launch; half of signups watched it" },
        { item: "Zero release-day incidents; the ship gate earned its keep" },
        { item: "Beta cohort emails were personal and it showed in replies" },
      ],
      couldImprove: [
        { item: "Pricing questions swamped support; the FAQ went up two days late" },
        { item: "We froze the branch but not the copy; three tweaks risked the freeze" },
      ],
      actions: [
        { item: "FAQ ships WITH the landing page next launch", done: false, owner: "Mina" },
        { item: "Copy freeze rides the branch freeze", done: true, owner: "Ramine" },
      ],
    },
  },
  {
    template: "texttext.calendar",
    title: "Essay: slow publishing",
    body: `Second essay in the craft series. Pairs with the launch-week changelog for the newsletter.`,
    fields: {
      publishDate: "2026-08-05",
      pieceStatus: "editing",
      channel: "blog",
      author: "Ramine",
    },
  },
  {
    template: "texttext.newsletter",
    title: "Matter & Method No. 12",
    body: `This month: why documents deserve shapes, a defense of slow publishing, and the best thing I read about multiplayer editing.`,
    fields: {
      issueNumber: 12,
      sentAt: "2026-08-01",
      links: [
        { title: "Documents now have shapes", url: "https://texttext.app/changelog", blurb: "The 0.154 release: 23 looks, typed fields, folders that organize themselves." },
        { title: "The case for slow publishing", url: "https://texttext.app/@demo/slow-publishing", blurb: "The writing worth reading in five years is the writing someone sat on for five weeks." },
        { title: "How Figma's multiplayer works", url: "https://www.figma.com/blog/how-figmas-multiplayer-technology-works/", blurb: "Still the best public writeup of real-world sync." },
      ],
    },
  },
  {
    template: "texttext.now",
    title: "Now",
    body: `What I am doing these days, in the spirit of nownownow.com. Updated when it changes, not on a schedule.`,
    fields: {
      location: "San Francisco",
      lastUpdated: "2026-07-29",
      currently: [
        { area: "Building", detail: "Texttext, a document workspace where every page has a shape" },
        { area: "Reading", detail: "Piranesi, slowly, on purpose" },
        { area: "Listening", detail: "The Caretaker while writing, nothing while editing" },
        { area: "Learning", detail: "Enough Postgres query planning to be dangerous" },
      ],
    },
  },
  {
    template: "texttext.prompts",
    title: "Changelog entry writer",
    body: `Turns a git log into a user-facing changelog entry in the house voice.\n\n\`\`\`\nWrite a changelog entry for the release below. Plain language a user can act\non, sentence case, no engineering detail, no em dashes. Lead with the change\nthat matters most to someone using the product today.\n\nCommits:\n{{commits}}\n\`\`\``,
    fields: {
      model: "claude-opus-5",
      useCase: "writing",
      proven: true,
      variables: [
        { name: "commits", purpose: "The git log --oneline output for the release" },
      ],
    },
  },
];
