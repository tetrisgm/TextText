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

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { ASSISTANT_SYSTEM_PROMPT } from "../src/lib/ai/system-prompt";
import { cloudAssistantToolNames } from "../src/lib/ai/cloud-tools";
import { WORKSPACE_TOOL_DEFINITIONS } from "../src/lib/ai/tools";
import { runWorkspaceToolForSession } from "../src/lib/mcp/tools";
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

// ---------------------------------------------------------------- the model

function runModel(prompt: string): Promise<string> {
  const [cmd, args] =
    ENGINE === "codex"
      ? (["codex", ["exec", "--skip-git-repo-check", prompt]] as const)
      : (["claude", ["-p", prompt]] as const);
  return new Promise((resolve) => {
    const child = spawn(cmd, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 420_000);
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

/**
 * Pull one decision object out of whatever the CLI printed around it. The
 * CLIs wrap an answer in tens of kilobytes of session log, so anchoring on the
 * first brace finds log noise; this requires the shape we asked for.
 */
function extractDecision(
  text: string,
): { tool: string; args: Record<string, unknown> } | { done: string } | null {
  const bodies: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    if (match[1]) bodies.push(match[1]);
  }
  bodies.push(text);
  for (const body of bodies.reverse()) {
    const starts: number[] = [];
    for (const match of body.matchAll(/\{/g)) {
      if (match.index !== undefined) starts.push(match.index);
    }
    for (const start of starts) {
      for (let end = body.length - 1; end > start; end -= 1) {
        if (body[end] !== "}") continue;
        try {
          const parsed = JSON.parse(body.slice(start, end + 1)) as Record<
            string,
            unknown
          >;
          if (typeof parsed.tool === "string") {
            return {
              tool: parsed.tool,
              args: (parsed.args as Record<string, unknown>) ?? {},
            };
          }
          if (typeof parsed.done === "string") return { done: parsed.done };
        } catch {
          // keep looking
        }
      }
    }
  }
  return null;
}

// ------------------------------------------------------------- the workspace

async function signIn(page: Page, email: string): Promise<string> {
  await page.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 30000 });
  await form.locator('input[type="email"]').fill(email);
  await form.locator('input[aria-label="Name"]').fill("Sidebar Eval");
  await form.locator('button[type="submit"]').click();
  await form.waitFor({ state: "detached", timeout: 40000 }).catch(() => undefined);
  await page.waitForTimeout(3500);
  const handle = new URL(page.url()).pathname.match(/^\/@([^/?#]+)/)?.[1];
  if (!handle) throw new Error(`sign-in did not reach a workspace: ${page.url()}`);
  return handle;
}

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

type Actor = { sub: string; userId: string | null; handle: string };

/** Run one workspace tool the way the assistant does, and return its text. */
async function callTool(
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; text: string }> {
  const result = await runWorkspaceToolForSession(name as never, args, actor);
  const text = (result.content ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
  return { ok: !result.isError, text };
}

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

function toolCatalogue(): string {
  return cloudAssistantToolNames()
    .map((name) => {
      const definition = WORKSPACE_TOOL_DEFINITIONS[name];
      return `### ${name}\n${definition.description}\nInput JSON Schema:\n${JSON.stringify(definition.jsonSchema)}`;
    })
    .join("\n\n");
}

type Transcript = Array<{ step: number; tool: string; ok: boolean; detail: string }>;

async function converse(
  handle: string,
  actor: { sub: string; userId: string | null; handle: string },
  brief: (typeof BRIEFS)[number],
  folderPath: string,
): Promise<Transcript> {
  const transcript: Transcript = [];
  const history: string[] = [];
  const catalogue = toolCatalogue();

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const prompt = [
      ASSISTANT_SYSTEM_PROMPT,
      "",
      `Current view: level workspace, folder ${folderPath}.`,
      "",
      "You act by choosing ONE tool per turn. These are your tools:",
      "",
      catalogue,
      "",
      "The conversation so far:",
      `user: ${brief.ask}`,
      ...history,
      "",
      // Deliberately NOT valid JSON: these CLIs reprint the prompt in their
      // output, so a complete example object gets found by the extractor and
      // read back as the model's own answer. It looped fourteen times echoing
      // a placeholder before this was noticed.
      "Reply with ONLY a JSON object and nothing else. No prose, no code fence.",
      "To call a tool, the object has a key tool whose value is the tool name, and a key args whose value is the argument object.",
      "Once the request has been fully carried out, instead reply with an object whose only key is done, whose value is a sentence describing what actually changed.",
      "Do not report done before calling the tools that make the change.",
    ].join("\n");

    const raw = await runModel(prompt);
    writeFileSync(`${OUT}/${brief.key}-step${step}.txt`, raw);
    // Drop the echoed prompt before reading an answer out of the tail.
    const answer = raw.includes(prompt)
      ? raw.slice(raw.lastIndexOf(prompt) + prompt.length)
      : raw;
    const decision = extractDecision(answer);
    if (!decision) {
      transcript.push({ step, tool: "(none)", ok: false, detail: "no decision in reply" });
      break;
    }
    if ("done" in decision) {
      // A model that reports done before calling anything has answered the
      // request in prose. Push back once rather than scoring an empty run.
      const didSomething = transcript.some((entry) => entry.ok && entry.tool !== "(done)");
      const pushbacks = transcript.filter((e) => e.tool === "(premature done)").length;
      if (!didSomething && pushbacks < 2 && step < MAX_STEPS) {
        transcript.push({ step, tool: "(premature done)", ok: false, detail: decision.done.slice(0, 200) });
        history.push(
          `assistant said done: ${decision.done.slice(0, 200)}`,
          "user: nothing has changed in the workspace yet. Carry the request out with the tools.",
        );
        continue;
      }
      transcript.push({ step, tool: "(done)", ok: true, detail: decision.done.slice(0, 200) });
      break;
    }
    if (!cloudAssistantToolNames().includes(decision.tool as never)) {
      const detail = `unknown tool ${decision.tool}`;
      transcript.push({ step, tool: decision.tool, ok: false, detail });
      history.push(`assistant called ${decision.tool}`, `tool error: ${detail}`);
      continue;
    }

    let ok = true;
    let detail = "";
    try {
      const result = await runWorkspaceToolForSession(
        decision.tool as never,
        decision.args,
        actor,
      );
      detail = (result.content ?? [])
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n")
        .slice(0, 4000);
      ok = !result.isError;
    } catch (error) {
      ok = false;
      detail = error instanceof Error ? error.message : String(error);
    }
    transcript.push({ step, tool: decision.tool, ok, detail: detail.slice(0, 300) });
    note(`    ${ok ? "ok  " : "ERR "} ${decision.tool}${ok ? "" : ` - ${detail.slice(0, 160)}`}`);
    history.push(
      `assistant called ${decision.tool} with ${JSON.stringify(decision.args).slice(0, 1500)}`,
      `tool ${ok ? "result" : "error"}: ${detail.slice(0, 1500)}`,
    );
  }
  return transcript;
}

// ------------------------------------------------------------------ the run

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  cwd: process.cwd(),
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function waitForServer(): Promise<void> {
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
async function requireDevSignInBuild(): Promise<void> {
  const html = await fetch(`${BASE}/editor`, { redirect: "manual" })
    .then((response) => response.text())
    .catch(() => "");
  if (html.includes("ac-devsignin")) return;
  throw new Error(
    `${BASE}/editor has no dev sign-in, so this eval cannot sign in.\n` +
      "The .next build being served was made without AUTH_DEV_LOGIN=1,\n" +
      "which is what `vercel build --prod` leaves behind. Rebuild locally:\n" +
      "  npm run build",
  );
}

/** The model is a local CLI, not a provider key. Say which one is missing. */
function requireModelCli(): void {
  const found = spawnSync("which", [ENGINE], { encoding: "utf8" });
  if (found.status === 0 && found.stdout.trim()) return;
  throw new Error(
    `The "${ENGINE}" CLI is not on PATH, and this eval uses it as the model.\n` +
      "Install it, or run with a different one: npm run eval:sidebar -- all claude",
  );
}

async function main(): Promise<void> {
  requireModelCli();
  await waitForServer();
  await requireDevSignInBuild();
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
    const urlHandle = await signIn(page, email);
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

    const transcript = await converse(
      handle,
      { sub, userId: userId ?? null, handle },
      brief,
      folderPath,
    );

    // Give the items the shape the look expects before looking at it.
    const filled = await fillDeclaredFields(
      { sub, userId: userId ?? null, handle },
      folderPath,
      seededIds,
    );
    if (filled.length) note(`  filled fields: ${filled.join(", ")}`);

    // What a person sees afterwards: the index, an opened item, the editor.
    await page.goto(folderUrl, { waitUntil: "domcontentloaded" });
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
    server.kill("SIGTERM");
    await sleep(900);
    if (!server.killed) server.kill("SIGKILL");
    process.exit(code);
  });
