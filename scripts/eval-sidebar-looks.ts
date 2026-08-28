// Ask the sidebar for a kind of thing. Screenshot what you get.
//
// This drives the REAL assistant path: the same system prompt the route uses
// (ASSISTANT_SYSTEM_PROMPT), the same tool set the web assistant is given
// (cloudAssistantToolNames), and the same executor those tool calls run
// through (runWorkspaceToolForSession). Only the model provider is swapped for
// a local CLI, because TextText never spends a shared provider key.
//
// It does not score itself. Scoring a look by asserting on its JSON is how the
// last version of this passed while producing pages nobody would ship. It
// produces screenshots of the folder index, an opened item, and the editor,
// and those get judged by eye against the reference the brief names.
//
//   npm run build                           # REQUIRED, see below
//   npm run eval:sidebar                    # every brief, via codex
//   npm run eval:sidebar -- medium-blog     # one brief
//   npm run eval:sidebar -- all claude      # a different local model
//
// Nothing is deployed and no production database is touched.
//
// It serves .next with `next start`, so it needs a production build made
// LOCALLY: `npm run build` reads .env.local, which carries AUTH_DEV_LOGIN=1,
// and the dev sign-in this eval signs in through only exists when that is set.
// A build left behind by `vercel build --prod` looks identical on disk and has
// no dev sign-in in it, and the only symptom was a 30 second wait for a form
// that was never coming. The preflight below says so instead.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import {
  callTool,
  converse,
  requireDevSignInBuild,
  requireModelCli,
  signIn,
  type Actor,
} from "./eval-agent-harness";
import { getOwnedBlog, getUserIdBySub } from "../src/lib/store";

const ONLY = process.argv[2] && process.argv[2] !== "all" ? process.argv[2] : null;
const ENGINE = (process.argv[3] ?? "codex") as "claude" | "codex";
const OUT = process.env.SIDEBAR_EVAL_OUT ?? "/tmp/sidebar-looks";
const PORT = Number(process.env.SIDEBAR_EVAL_PORT ?? 3180);
// localhost, not 127.0.0.1: next-auth redirects to localhost, and a session
// cookie set on the other host is never sent back.
const BASE = `http://localhost:${PORT}`;
const MAX_STEPS = 14;
/** Committed, so drift is visible across machines and months. */
const BASELINE = "docs/sidebar-looks-baseline.json";
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

mkdirSync(OUT, { recursive: true });
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is unset: run with --env-file=.env.local");
  process.exit(1);
}

/** What a person types, and the thing they are pointing at. */
const BRIEFS = [
  {
    key: "medium-blog",
    ask: "Make my blog look like Medium.",
    reference:
      "Index: single-column rows, title, one-line description, small thumbnail, no body. Item: serif display title, byline with read time. Editor: title, description, body. No extra fields.",
  },
  {
    key: "apple-notes",
    ask: "Turn my Notes into something that looks like Apple Notes.",
    folder: "notes",
    reference:
      "Index: plain list of titles with a date and one-line preview. Item: white, date, ~34px left title, 17px body, nothing else. Editor: title and body only.",
  },
  {
    key: "notion-page",
    ask: "I want pages that look like Notion.",
    reference:
      "Index: quiet list of page titles. Item: full-bleed cover strip, emoji icon over its edge, 40px left title, 16px blocks, one left edge. Editor: cover and icon reachable.",
  },
  {
    key: "todo-list",
    ask: "Make this a to-do list like Todoist: each task has a checkbox, a due date and a priority, and I want to see what is still open.",
    folder: "notes",
    reference:
      "A DIFFERENT KIND OF THING, not restyled prose. The item needs real fields: done (boolean), due (date), priority (enum). Index: rows that read as tasks. Editor: those three fields present and editable, not buried in a disclosure.",
  },
  {
    key: "raindrop-bookmarks",
    ask: "Make my bookmarks work like Raindrop: I paste a link and I get a card with the site, the title and a picture, and I can read it later.",
    folder: "bookmarks",
    reference:
      "Raindrop: index of cards, each with a thumbnail, the title, and the source domain small and quiet. Item: a calm reading view with the source and a link out. Editor: the URL is the primary field.",
  },
  // The five above cover prose, plain notes, pages, tasks and links. These
  // four reach primitives none of them touch: checklist and facts, a gallery,
  // a heatmap over dates, and rows with a quote. A primitive the suite never
  // asks for is a primitive nobody finds out is broken.
  {
    key: "recipe-cards",
    ask: "Make my notes work like a recipe box: each recipe has ingredients I can tick off, a cook time, and how many it serves.",
    folder: "notes",
    reference:
      "Ingredients as a real checklist that ticks, not prose. Cook time and servings shown as facts near the top. Index: cards you could pick a dinner from.",
  },
  {
    key: "photo-journal",
    ask: "I want a photo journal: each entry is a few pictures and a short caption, and the index should be a wall of images by date.",
    reference:
      "Item: a gallery of images with the caption under them, not one cover and a body. Index: image-led and dated, closer to a wall than a list.",
  },
  {
    key: "habit-tracker",
    ask: "Track my running: one entry per run with the date and the distance, and show me the year as a grid of days so I can see the gaps.",
    folder: "notes",
    reference:
      "A DIFFERENT KIND OF THING. Fields: date and distance (number). The collection is a heatmap or calendar keyed on the date, not a list.",
  },
  {
    key: "reading-notes",
    ask: "Reading notes: each book gets my rating, and quotes I want to keep with the page number.",
    folder: "notes",
    reference:
      "Rating as an enum or number, not prose. Quotes as rows with a page number, set as quotes rather than paragraphs. Index: rows that read as books with their rating.",
  },
] as const;

/**
 * The part of a result that should hold still between runs.
 *
 * The model is not deterministic, so fonts, sizes and colours differ every
 * time and comparing them would cry wolf on every run. What should NOT drift
 * is the shape of the answer: whether a look was applied at all, which parts
 * the index and the item show, and whether the fields the brief asked for are
 * reachable in the editor or buried. When one of those changes, something
 * about the model, the prompt, or the primitives changed with it.
 *
 * This is measured from the RENDERED page, never from the blueprint JSON.
 * Scoring a look by asserting on its JSON is how an earlier version of this
 * eval passed while producing pages nobody would ship.
 */
type BriefShape = {
  applied: boolean;
  indexShows: string[];
  itemHas: string[];
  editorInline: string[];
  editorBuried: string[];
};

function flagsOf(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, on]) => on === true)
    .map(([name]) => name)
    .sort();
}

function labelsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  // Keep the field NAME, drop its type: a field moving from text to richtext
  // is a design choice, a field disappearing is a regression.
  return value
    .map((entry) => String(entry).split(":")[0].trim())
    .filter(Boolean)
    .sort();
}

function stableShape(input: {
  applied: boolean;
  index: Record<string, unknown> | null;
  item: Record<string, unknown> | null;
  editor: Record<string, unknown> | null;
}): BriefShape {
  return {
    applied: input.applied,
    indexShows: flagsOf(input.index?.shows),
    itemHas: flagsOf(input.item?.has),
    editorInline: labelsOf(input.editor?.inline),
    editorBuried: labelsOf(input.editor?.buried),
  };
}

function describeDrift(before: BriefShape, after: BriefShape): string[] {
  const drift: string[] = [];
  if (before.applied !== after.applied) {
    drift.push(`applied ${before.applied} -> ${after.applied}`);
  }
  const lists: Array<keyof BriefShape> = [
    "indexShows",
    "itemHas",
    "editorInline",
    "editorBuried",
  ];
  for (const key of lists) {
    const was = before[key] as string[];
    const now = after[key] as string[];
    const gone = was.filter((entry) => !now.includes(entry));
    const added = now.filter((entry) => !was.includes(entry));
    if (gone.length || added.length) {
      drift.push(
        `${key}${gone.length ? ` -${gone.join(",")}` : ""}${
          added.length ? ` +${added.join(",")}` : ""
        }`,
      );
    }
  }
  return drift;
}

const shapes: Record<string, BriefShape> = {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const notes: string[] = [];
const note = (line: string) => {
  notes.push(line);
  console.log(line);
};

// ------------------------------------------------------------- the workspace

const SEED: Record<string, Array<[string, string]>> = {
  blog: [
    ["The case for slow software", "Why the fastest team ships least"],
    ["What the outage taught us", "Three weeks of pager duty, condensed"],
    ["Writing for strangers", "The reader who shows up is not the one you pictured"],
  ],
  notes: [
    ["Things I keep relearning", "A running list"],
    ["Questions for Thursday", "Before the review"],
    ["Half an idea about caching", "Probably wrong"],
  ],
  bookmarks: [
    ["How Figma's multiplayer works", "figma.com"],
    ["The website obesity crisis", "idlewords.com"],
    ["Reflections on trusting trust", "cs.cmu.edu"],
  ],
};

/**
 * Seeded through the product's own tools rather than the store.
 *
 * `getFolders` memoizes with React's `cache`, which outside a request scope
 * holds its first answer for the life of the process - and the first answer
 * here is taken before the server has lazily created the workspace's folders.
 * Going through create_item sidesteps the folder id entirely and exercises the
 * same path an agent uses.
 */
async function seed(actor: Actor, folderPath: string): Promise<string[]> {
  const covers = [
    "/covers/cover-118.jpg",
    "/covers/cover-119.jpg",
    "/covers/cover-120.jpg",
  ];
  const icons = ["\u{1F9ED}", "\u{1F4DD}", "\u{1F4A1}"];
  const ids: string[] = [];
  let i = 0;
  for (const [title, subtitle] of SEED[folderPath] ?? SEED.blog) {
    const body = `${subtitle}. The opening paragraph, which an index has no business printing in full.`;
    const created = await callTool(actor, "create_item", {
      folder_path: folderPath,
      title,
      body,
      excerpt: subtitle,
    });
    if (!created.ok) {
      throw new Error(`seeding ${folderPath} failed: ${created.text.slice(0, 300)}`);
    }
    // The reference screenshots have covers and icons, so the items must too.
    // Without a value a correctly authored cover node is hidden by its own
    // showWhen, and the look gets blamed for the seed data being bare.
    const id = created.text.match(/"id"\s*:\s*"([^"]+)"/)?.[1];
    if (id) {
      await callTool(actor, "update_item", {
        id,
        fields: { cover: covers[i % covers.length], icon: icons[i % icons.length] },
      });
    }
    if (id) ids.push(id);
    i += 1;
  }
  return ids;
}

/**
 * Fill every item with values for the fields the LOOK declares.
 *
 * The assistant invents its own field names - a bookmark look asks for
 * `picture` and `site`, not the `cover` this harness seeded - so without this
 * a correctly authored row hides its own thumbnail behind showWhen and the
 * look gets blamed for an empty collection. A real workspace has content in
 * the shape of its look; the test should too.
 */
function sampleValue(
  field: { id: string; type: string; options?: Array<{ value: string }>; fields?: Array<{ id: string; type: string }> },
  index: number,
  subtitle: string,
): unknown {
  switch (field.type) {
    case "image":
      return ["/covers/cover-118.jpg", "/covers/cover-119.jpg", "/covers/cover-120.jpg"][index % 3];
    case "url":
      return ["https://www.figma.com/blog/how-figmas-multiplayer-technology-works/", "https://idlewords.com/talks/website_obesity.htm", "https://dl.acm.org/doi/10.1145/358198.358210"][index % 3];
    case "date":
      return ["2026-08-12", "2026-08-14", "2026-08-19"][index % 3];
    case "boolean":
      // One ticked, so a finished state is visible next to unfinished ones.
      return index === 2;
    case "enum":
      return field.options?.[index % Math.max(1, field.options.length)]?.value ?? null;
    case "number":
      return [8, 12, 5][index % 3];
    case "richtext":
      return subtitle;
    case "rows":
      return (field.fields ?? []).length
        ? [1, 2].map((n) =>
            Object.fromEntries(
              (field.fields ?? []).map((sub) => [
                sub.id,
                sub.type === "boolean" ? n === 1 : sub.type === "date" ? "2026-08-15" : `${sub.id} ${n}`,
              ]),
            ),
          )
        : null;
    default:
      return subtitle;
  }
}

async function fillDeclaredFields(
  actor: Actor,
  folderPath: string,
  ids: string[],
): Promise<string[]> {
  const folders = await callTool(actor, "list_folders", {});
  const reference = JSON.parse(folders.text).folders.find(
    (f: { path: string }) => f.path === folderPath,
  )?.defaultTemplate;
  if (!reference || reference.id.startsWith("texttext.")) return [];
  const listed = await callTool(actor, "list_document_templates", {});
  const template = JSON.parse(listed.text).templates.find(
    (t: { id: string; version: number }) =>
      t.id === reference.id && t.version === reference.version,
  );
  if (!template) return [];
  const seedRows = SEED[folderPath] ?? SEED.blog;
  for (const [index, id] of ids.entries()) {
    const values: Record<string, unknown> = {};
    for (const field of template.fields ?? []) {
      const value = sampleValue(field, index, seedRows[index]?.[1] ?? "");
      if (value !== null && value !== undefined) values[field.id] = value;
    }
    if (Object.keys(values).length) {
      await callTool(actor, "update_item", { id, fields: values });
    }
  }
  return (template.fields ?? []).map((f: { id: string }) => f.id);
}


/**
 * What the look actually became on screen. Screenshots say something is wrong;
 * these say which declaration was dropped and by how much.
 */
// Passed to the browser as source, not as a function reference: tsx compiles
// arrow functions with an esbuild `__name` helper that does not exist in the
// page, and page.evaluate(fn) serializes the body only.
const MEASURE_INDEX = `(() => {
  const card = document.querySelector(".tt-document.tt-collection-item");
  const cs = (el) => getComputedStyle(el);
  const fam = (el) => cs(el).fontFamily.split(",")[0].replace(/["']/g, "");
  if (!card) {
    return {
      error: "no collection item on the page",
      containers: Array.from(document.querySelectorAll(".universal-item-collection, .blog-folder-feed, .post-folder-list")).map((el) => el.className),
      rows: Array.from(document.querySelectorAll("[data-workspace-post-id]")).slice(0, 2).map((el) => el.className),
    };
  }
  // A toggle's label IS the row's title on a task list, so it counts.
  const title = card.querySelector(
    ".tt-text-heading, .tt-text-title, .tt-toggle-label, .tt-text",
  );
  let painted = "rgba(0, 0, 0, 0)";
  for (let el = card; el; el = el.parentElement) {
    const bg = cs(el).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") { painted = bg; break; }
  }
  return {
    typography: card.getAttribute("data-typography"),
    surface: card.getAttribute("data-surface"),
    declaredFont: cs(card).getPropertyValue("--tt-font").trim().split(",")[0],
    cardFont: fam(card),
    titleFont: title ? fam(title) : null,
    titleSize: title ? Math.round(parseFloat(cs(title).fontSize)) : null,
    paintedBackground: painted,
    dumpsBody: /no business printing in full/.test(card.textContent || ""),
    // How tall a row is, and what it actually shows. An index that scans well
    // is the difference between a collection and a list of links.
    rowHeight: Math.round(card.getBoundingClientRect().height),
    shows: {
      checkbox: !!card.querySelector(".tt-toggle, .tt-checkbox, input[type=checkbox]"),
      cover: !!card.querySelector(".tt-cover, .tt-image"),
      badge: !!card.querySelector(".tt-badge, .tt-pill"),
      facts: !!card.querySelector(".tt-facts"),
      metadata: !!card.querySelector(".tt-metadata"),
      caption: !!card.querySelector(".tt-text-caption, .tt-text-meta"),
    },
  };
})()`;

const MEASURE_EDITOR = `(() => {
  const root = document.querySelector(".tt-unified-editor");
  if (!root) return { error: "not in the editor" };
  const label = (el) => (el.querySelector(".tt-field-label")?.textContent || "").trim();
  const kind = (el) => (el.className.match(/is-([a-z]+)/) || [])[1] || "?";
  const all = Array.from(root.querySelectorAll(".tt-field-row"));
  const details = root.querySelector(".tt-field-details");
  const buried = details ? Array.from(details.querySelectorAll(".tt-field-row")) : [];
  const buriedSet = new Set(buried);
  return {
    // Fields a person meets without opening anything.
    inline: all.filter((el) => !buriedSet.has(el)).map((el) => label(el) + ":" + kind(el)),
    // Fields the look declared but did not place, hidden behind a disclosure.
    buried: buried.map((el) => label(el) + ":" + kind(el)),
    disclosureOpen: details ? details.hasAttribute("open") : null,
    hasTitle: !!root.querySelector(".tt-field-title, .tt-collaborative-field"),
    hasBody: !!root.querySelector(".tt-md-surface"),
  };
})()`;

const MEASURE_ITEM = `(() => {
  const doc = document.querySelector(".tt-document:not(.tt-collection-item)");
  if (!doc) return { error: "no document on the page" };
  const cs = (el) => getComputedStyle(el);
  const fam = (el) => cs(el).fontFamily.split(",")[0].replace(/["']/g, "");
  const title = doc.querySelector(".tt-text-title");
  const prose = doc.querySelector(".tt-prose");
  return {
    typography: doc.getAttribute("data-typography"),
    surface: doc.getAttribute("data-surface"),
    alignment: doc.getAttribute("data-alignment"),
    paper: cs(doc).backgroundColor,
    titleFont: title ? fam(title) : null,
    titleSize: title ? Math.round(parseFloat(cs(title).fontSize)) : null,
    titleAlign: title ? cs(title).textAlign : null,
    titleTop: title ? Math.round(title.getBoundingClientRect().top) : null,
    proseSize: prose ? Math.round(parseFloat(cs(prose).fontSize)) : null,
    proseWidth: prose ? Math.round(prose.getBoundingClientRect().width) : null,
    // Which structural elements the look actually reached for. A page can hit
    // every type measurement and still be missing the thing that makes the
    // reference recognisable - a date line, a cover, an icon.
    has: {
      metadata: !!doc.querySelector(".tt-metadata"),
      byline: !!doc.querySelector(".tt-byline"),
      cover: !!doc.querySelector(".tt-cover"),
      icon: !!doc.querySelector(".tt-text-icon"),
      eyebrow: !!doc.querySelector(".tt-text-eyebrow"),
    },
  };
})()`;

// ------------------------------------------------------------- the agent loop

/**
 * The folder the assistant put its look on, which is not always the one it was
 * pointed at. A brief that says "notes" may correctly produce notes/running.
 * Falls back to the seeded folder when nothing new carries a look.
 */
async function folderCarryingANewLook(
  actor: Actor,
  seededPath: string,
): Promise<string> {
  const listed = await callTool(actor, "list_folders", {});
  if (!listed.ok) return seededPath;
  let folders: Array<{ path?: string; defaultTemplate?: { id?: string } }> = [];
  try {
    folders = (JSON.parse(listed.text) as { folders?: typeof folders }).folders ?? [];
  } catch {
    return seededPath;
  }
  // A custom look, not one of the built-ins every folder starts with.
  const custom = folders.filter(
    (folder) =>
      folder.path &&
      folder.defaultTemplate?.id &&
      !folder.defaultTemplate.id.startsWith("texttext."),
  );
  const seeded = custom.find((folder) => folder.path === seededPath);
  if (seeded?.path) return seeded.path;
  // Prefer one under the folder the brief named, then any at all.
  const nested = custom.find((folder) => folder.path?.startsWith(`${seededPath}/`));
  return nested?.path ?? custom[0]?.path ?? seededPath;
}

// ------------------------------------------------------------------ the run

/**
 * `next dev` and `next start` share one .next directory, so they cannot both
 * be right at the same time. The other eleven evals need a dev server; this
 * one used to spawn `next start` unconditionally and serve whatever .next
 * happened to hold. A `vercel build --prod` earlier in the day therefore made
 * it fail with a message blaming the build, on a machine where the suite had
 * passed hours before. Reuse a server that is already answering; only spawn
 * one when nothing is there.
 */
async function alreadyServing(): Promise<boolean> {
  try {
    const response = await fetch(BASE, { redirect: "manual" });
    return response.status < 500;
  } catch {
    return false;
  }
}

// Decided inside waitForServer, not here: tsx transforms this file as CJS,
// where a top-level await is a hard transform error that tsc does not see.
let server: ChildProcess | null = null;
let serverLog = "";

async function waitForServer(): Promise<void> {
  if (await alreadyServing()) return;
  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d) => (serverLog += d));
  server.stderr?.on("data", (d) => (serverLog += d));
  for (let i = 0; i < 160; i += 1) {
    try {
      const res = await fetch(BASE, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`server never came up:\n${serverLog.slice(-3000)}`);
}

/**
 * The dev sign-in has to be in the build being served.
 *
 * This eval signs in through it, and it is compiled away unless the build was
 * made with AUTH_DEV_LOGIN=1. `vercel build --prod` leaves exactly such a
 * build in .next, so a deploy earlier in the day is enough to break this with
 * no other trace.
 */
async function main(): Promise<void> {
  requireModelCli(ENGINE, "npm run eval:sidebar -- all claude");
  await waitForServer();
  await requireDevSignInBuild(BASE);
  note(`server up on ${BASE}, model ${ENGINE}`);

  const browser = await chromium.launch();
  const summary: Array<{ brief: string; steps: number; applied: boolean }> = [];

  for (const brief of BRIEFS) {
    if (ONLY && brief.key !== ONLY) continue;
    note(`\n=== ${brief.key}: "${brief.ask}"`);
    const folderPath = (brief as { folder?: string }).folder ?? "blog";
    const email = `sidebar+${brief.key}-${Date.now().toString(36)}@example.com`;
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    const urlHandle = await signIn(page, BASE, email, "Sidebar Eval");
    const sub = `dev:${email.toLowerCase()}`;
    const userId = await getUserIdBySub(sub);
    const owned = await getOwnedBlog(sub);
    if (!owned) throw new Error(`no owned workspace for ${sub}`);
    // The workspace URL can carry a username alias; the tools resolve by the
    // blog's own handle, so take that one.
    const handle = owned.handle;
    note(
      `  workspace ${handle}${urlHandle === handle ? "" : ` (url showed @${urlHandle})`}`,
    );

    // Render the workspace first: that is what creates its folders.
    const folderUrl = `${BASE}/@${urlHandle}?folder=${folderPath}`;
    await page.goto(folderUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const seededIds = await seed({ sub, userId: userId ?? null, handle }, folderPath);
    await page.goto(folderUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2400);
    await page.screenshot({ path: `${OUT}/${brief.key}-1-before.png` });

    const transcript = await converse({
      ask: brief.ask,
      actor: { sub, userId: userId ?? null, handle },
      contextLine: `Current view: level workspace, folder ${folderPath}.`,
      engine: ENGINE,
      maxSteps: MAX_STEPS,
      onRawStep: (step, raw) => writeFileSync(`${OUT}/${brief.key}-step${step}.txt`, raw),
      note,
    });

    // Measure where the look actually landed.
    //
    // The assistant is free to make a folder of its own, and often should: the
    // running brief produced a Runs type on notes/running with a date, a
    // distance and a heatmap, entirely correctly. Measuring the seeded folder
    // reported "no fields at all" for a whole session, and that reading went
    // into a plan as a defect in the model. It was a defect in this line.
    const measuredPath = await folderCarryingANewLook(
      { sub, userId: userId ?? null, handle },
      folderPath,
    );
    let measuredIds = seededIds;
    if (measuredPath !== folderPath) {
      note(`  the look landed on ${measuredPath}, measuring there`);
      // Seed it too, or the index is measured empty and reports the look as
      // broken when the folder simply has nothing in it yet.
      measuredIds = await seed({ sub, userId: userId ?? null, handle }, measuredPath);
    }
    const folderUrlToMeasure = `${BASE}/@${urlHandle}?folder=${measuredPath}`;

    // Give the items the shape the look expects before looking at it.
    const filled = await fillDeclaredFields(
      { sub, userId: userId ?? null, handle },
      measuredPath,
      measuredIds,
    );
    if (filled.length) note(`  filled fields: ${filled.join(", ")}`);

    // What a person sees afterwards: the index, an opened item, the editor.
    await page.goto(folderUrlToMeasure, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2800);
    await page.screenshot({ path: `${OUT}/${brief.key}-2-index.png` });
    const indexMeasure = await page.evaluate(MEASURE_INDEX);
    note(`  index:  ${JSON.stringify(indexMeasure)}`);
    let itemMeasured: Record<string, unknown> | null = null;
    let editorMeasured: Record<string, unknown> | null = null;

    const firstCard = page
      .locator("[data-workspace-post-id] a, .universal-item-card a, .blog-folder-feed-link")
      .first();
    if (await firstCard.count()) {
      await firstCard.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(2800);
      await page.screenshot({ path: `${OUT}/${brief.key}-3-item.png` });
      const itemMeasure = await page.evaluate(MEASURE_ITEM);
      itemMeasured = itemMeasure as Record<string, unknown>;
      note(`  item:   ${JSON.stringify(itemMeasure)}`);
      // The third surface: creating or editing one of these things.
      //
      // Two routes, because neither works for every kind: a note opens
      // straight into the editor through client routing without the URL
      // changing, while a blog post needs the edit flag. Try the flag, and if
      // the editor is not there, use whatever Edit control the item offers.
      const editor = page.locator(".tt-unified-editor");
      if (!(await editor.count())) {
        const itemUrl = page.url();
        if (!/[?&]edit=1/.test(itemUrl)) {
          await page
            .goto(`${itemUrl}${itemUrl.includes("?") ? "&" : "?"}edit=1`, {
              waitUntil: "domcontentloaded",
            })
            .catch(() => undefined);
          await editor.first().waitFor({ timeout: 12000 }).catch(() => undefined);
        }
      }
      if (!(await editor.count())) {
        const control = page
          .getByRole("link", { name: /^Edit$/ })
          .or(page.getByRole("button", { name: /^Edit$/ }))
          .first();
        if (await control.count()) {
          await control.click({ force: true }).catch(() => undefined);
          await editor.first().waitFor({ timeout: 12000 }).catch(() => undefined);
        }
      }
      await page.waitForTimeout(1500);
      if (await page.locator(".tt-unified-editor").count()) {
        await page.screenshot({ path: `${OUT}/${brief.key}-4-editor.png` });
        editorMeasured = (await page.evaluate(MEASURE_EDITOR)) as Record<string, unknown>;
        note(`  editor: ${JSON.stringify(editorMeasured)}`);
      } else {
        note("  editor: could not reach it");
      }
    }

    // Ask the product what the folder carries now, through the tool surface.
    const listed = await callTool({ sub, userId: userId ?? null, handle }, "list_folders", {});
    const applied = /"(default_?[Tt]emplate|template)"\s*:\s*\{[^}]*"id"\s*:\s*"(?!texttext\.)/.test(
      listed.text,
    );
    note(`  folders after: ${listed.text.replace(/\s+/g, " ").slice(0, 400)}`);
    note(`  ${applied ? "assistant applied a look" : "NO LOOK APPLIED (still built-in)"}`);
    const folder = { after: listed.text.slice(0, 4000) };
    summary.push({ brief: brief.key, steps: transcript.length, applied });
    shapes[brief.key] = stableShape({
      applied,
      index: indexMeasure as Record<string, unknown>,
      item: itemMeasured,
      editor: editorMeasured,
    });
    writeFileSync(
      `${OUT}/${brief.key}-transcript.json`,
      JSON.stringify({ brief, handle, transcript, folder }, null, 2),
    );
    await ctx.close();
  }

  await browser.close();
  note("\n--- what the assistant did ---");
  for (const row of summary) {
    note(
      `${row.brief.padEnd(16)} ${String(row.steps).padStart(2)} steps   ${
        row.applied ? "look applied" : "NO LOOK APPLIED"
      }`,
    );
  }
  // Regression tracking, without pretending to score.
  //
  // The baseline is committed, so drift is visible across machines and months
  // rather than only against whatever this laptop ran last. It reports what
  // CHANGED and leaves the judgement where it belongs: with the screenshots.
  const ran = Object.keys(shapes);
  if (ran.length > 0) {
    let baseline: Record<string, BriefShape> = {};
    if (existsSync(BASELINE)) {
      try {
        baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, BriefShape>;
      } catch {
        note(`\n(baseline at ${BASELINE} is unreadable; treating every brief as new)`);
      }
    }
    note("\n--- against the committed baseline ---");
    let drifted = 0;
    for (const key of ran) {
      const before = baseline[key];
      if (!before) {
        note(`${key.padEnd(20)} new, nothing to compare`);
        continue;
      }
      const drift = describeDrift(before, shapes[key]);
      if (drift.length === 0) {
        note(`${key.padEnd(20)} unchanged`);
      } else {
        drifted += 1;
        note(`${key.padEnd(20)} DRIFTED: ${drift.join("; ")}`);
      }
    }
    if (UPDATE_BASELINE) {
      writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, ...shapes }, null, 2)}\n`);
      note(`\nbaseline updated: ${BASELINE}`);
    } else if (drifted > 0) {
      note(
        `\n${drifted} brief(s) drifted. Look at the screenshots, then either fix it or accept it with --update-baseline.`,
      );
    }
  }

  note(
    `\nScreenshots in ${OUT}. These are not scored here: look at them against the brief's reference.`,
  );
}

let code = 0;
main()
  .catch((error) => {
    console.error(error);
    code = 1;
  })
  .finally(async () => {
    writeFileSync(`${OUT}/notes.txt`, notes.join("\n"));
    writeFileSync(`${OUT}/server.log`, serverLog.slice(-8000));
    server?.kill("SIGTERM");
    await sleep(900);
    if (server && !server.killed) server.kill("SIGKILL");
    process.exit(code);
  });
