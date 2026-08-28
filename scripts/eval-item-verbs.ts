// Can you tell the assistant what to do with an item you already have?
//
// Creating and reading were tested in plain English. Editing one was tested
// only with the edit handed to the test, so the model never had to work out
// what to change, and acting across several items was not tested anywhere. The
// verb the product is used for most had the least coverage.
//
// Every task here gives a REAL model the person's own sentence, lets it choose
// its own tools, and then asserts the DURABLE result by reading the workspace
// back. Never the model's summary of what it did: a run that answers "Added
// the section" over an unchanged note has to fail, and that is precisely the
// failure this exists to catch.
//
//   npm run eval:item-verbs                  every task
//   npm run eval:item-verbs -- add-section   one task
//   npm run eval:item-verbs -- all claude    a different model CLI
//
// Needs a dev server (any port via ITEM_VERBS_PORT, default 3000) and a local
// model CLI. It reuses a server that is already answering.

import { mkdirSync, writeFileSync } from "node:fs";

import { eq } from "drizzle-orm";
import { chromium } from "playwright";

import { db } from "@/lib/db/client";
import { actionAudit } from "@/lib/db/schema";
import { getOwnedBlog, getUserIdBySub } from "@/lib/store";

import {
  callTool,
  converse,
  requireDevSignInBuild,
  requireModelCli,
  signIn,
  type Actor,
  type Transcript,
} from "./eval-agent-harness";

const ONLY = process.argv[2] && process.argv[2] !== "all" ? process.argv[2] : null;
const ENGINE = (process.argv[3] ?? "codex") as "claude" | "codex";
const OUT = process.env.ITEM_VERBS_OUT ?? "/tmp/item-verbs";
const PORT = Number(process.env.ITEM_VERBS_PORT ?? 3000);
// localhost, not 127.0.0.1: next-auth redirects to localhost, and a session
// cookie set on the other host is never sent back.
const BASE = `http://localhost:${PORT}`;
const MAX_STEPS = 10;
/** One nonce for the whole run, so every task gets its own clean workspace. */
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;

function note(line: string): void {
  process.stdout.write(`${line}\n`);
}

// ------------------------------------------------------------------ the seed

/**
 * Deliberate, distinctive prose. The assertions look for exact sentences from
 * it, so a model that helpfully rewrites a paragraph while doing what it was
 * asked is caught rather than passed. "It should store my text, not rewrite
 * it" is the requirement being defended.
 */
const SEED: Array<{ key: string; title: string; body: string }> = [
  {
    key: "caching",
    title: "Half an idea about caching",
    body: [
      "The cache is not the problem. The invalidation story is the problem.",
      "",
      "Every time we have reached for a shorter TTL it has bought a week and cost",
      "a month. The honest fix is to make writes publish their own invalidation,",
      "which nobody wants to do because it touches nine call sites.",
    ].join("\n"),
  },
  {
    key: "outage",
    title: "What the outage taught us",
    body: [
      "Three weeks of pager duty, condensed into the parts worth keeping.",
      "",
      "The alert fired correctly and nobody believed it, because the same alert",
      "had cried wolf for two months. Trust in a signal is a resource you spend.",
    ].join("\n"),
  },
  {
    key: "strangers",
    title: "Writing for strangers",
    body: [
      "The reader who shows up is not the one you pictured.",
      "",
      "They arrived from a search result, they have no context, and they will",
      "leave in nine seconds unless the first line earns the second.",
    ].join("\n"),
  },
];

type Seeded = Record<string, string>;

async function seed(actor: Actor): Promise<Seeded> {
  const ids: Seeded = {};
  for (const entry of SEED) {
    const created = await callTool(actor, "create_item", {
      kind: "note",
      title: entry.title,
      body: entry.body,
    });
    const id = created.text.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/)?.[1];
    if (!id) throw new Error(`seed did not return an id for ${entry.key}: ${created.text.slice(0, 300)}`);
    ids[entry.key] = id;
  }
  return ids;
}

type Snapshot = { title: string; body: string; tags: string[]; status: string | null };

/**
 * read_item answers with the item's metadata plus the whole file, frontmatter
 * and all. The body is what is left after the frontmatter block, and comparing
 * bodies is the point of this eval, so the split has to be exact rather than
 * approximate.
 */
function bodyOf(markdown: string): string {
  if (!markdown.startsWith("---\n")) return markdown;
  const end = markdown.indexOf("\n---\n", 4);
  return end === -1 ? markdown : markdown.slice(end + 5);
}

async function snapshot(actor: Actor, id: string): Promise<Snapshot> {
  const read = await callTool(actor, "read_item", { id });
  if (!read.ok) throw new Error(`read_item failed for ${id}: ${read.text.slice(0, 200)}`);
  const parsed = JSON.parse(read.text) as {
    item?: { title?: string; tags?: string[]; status?: string | null };
    markdown?: string;
  };
  return {
    title: parsed.item?.title ?? "",
    body: bodyOf(parsed.markdown ?? ""),
    tags: parsed.item?.tags ?? [],
    status: parsed.item?.status ?? null,
  };
}

// ----------------------------------------------------------------- the tasks

type Check = { ok: boolean; why: string };

function check(ok: boolean, why: string): Check {
  return { ok, why };
}

type Task = {
  key: string;
  /** The person's own words. Nothing else is given to the model. */
  ask: string;
  /** Read the workspace and say whether the request was actually carried out. */
  verify: (context: {
    actor: Actor;
    ids: Seeded;
    before: Record<string, Snapshot>;
    transcript: Transcript;
  }) => Promise<Check[]>;
};

const TASKS: Task[] = [
  {
    key: "add-section",
    ask:
      'In my note "Half an idea about caching", add a section at the end headed Risks, ' +
      "with two bullet points under it. Leave everything already written exactly as it is.",
    verify: async ({ actor, ids, before }) => {
      const after = await snapshot(actor, ids.caching);
      const original = before.caching.body;
      const bullets = after.body
        .slice(after.body.toLowerCase().lastIndexOf("risks"))
        .split("\n")
        .filter((line) => /^\s*[-*+]\s+\S/.test(line));
      return [
        check(/^#{1,6}\s*risks\b/im.test(after.body), "a Risks heading was added"),
        check(bullets.length >= 2, `two bullets under it (found ${bullets.length})`),
        check(after.body.includes(original.trim()), "the original text is intact, not rewritten"),
        check(after.title === before.caching.title, "the title was left alone"),
      ];
    },
  },
  {
    key: "retitle",
    ask: 'Rename my note "Half an idea about caching" to "Caching, revisited". Do not change its text.',
    verify: async ({ actor, ids, before }) => {
      const after = await snapshot(actor, ids.caching);
      return [
        check(/caching,\s*revisited/i.test(after.title), `the title is now "${after.title}"`),
        check(after.body.trim() === before.caching.body.trim(), "the body is byte for byte unchanged"),
      ];
    },
  },
  {
    key: "summarize-into-note",
    ask:
      "Read my three notes and write me a new note called Weekly digest that summarises " +
      "all three in a sentence each. Leave the originals alone.",
    verify: async ({ actor, ids, before }) => {
      const listed = await callTool(actor, "list_items", { folder_path: "notes", limit: 50 });
      const digestId = (JSON.parse(listed.text) as { items?: Array<{ id: string; title: string }> })
        .items?.find((item) => /weekly digest/i.test(item.title))?.id;
      if (!digestId) {
        return [check(false, "a note called Weekly digest exists")];
      }
      const digest = await snapshot(actor, digestId);
      const mentions = (words: string[]) =>
        words.some((word) => digest.body.toLowerCase().includes(word));
      const untouched = await Promise.all(
        SEED.map(async (entry) => (await snapshot(actor, ids[entry.key])).body.trim()),
      );
      return [
        check(true, "a note called Weekly digest exists"),
        check(digest.body.trim().length > 80, "it has a real summary in it"),
        check(mentions(["cach", "invalidat", "ttl"]), "it covers the caching note"),
        check(mentions(["outage", "alert", "pager", "wolf"]), "it covers the outage note"),
        check(mentions(["stranger", "reader", "search"]), "it covers the strangers note"),
        check(
          untouched.every((body, index) => body === before[SEED[index].key].body.trim()),
          "the three originals are unchanged",
        ),
      ];
    },
  },
  {
    key: "tag-several",
    ask: "Tag all three of my notes with review.",
    verify: async ({ actor, ids, before }) => {
      const results = await Promise.all(SEED.map((entry) => snapshot(actor, ids[entry.key])));
      const tagged = results.filter((item) =>
        item.tags.some((tag) => tag.toLowerCase() === "review"),
      );
      return [
        check(tagged.length === SEED.length, `all three carry the tag (${tagged.length} of 3)`),
        check(
          results.every((item, index) => item.body.trim() === before[SEED[index].key].body.trim()),
          "no body was touched while tagging",
        ),
      ];
    },
  },
  {
    key: "refuse-missing",
    ask: 'Add a paragraph about rollback procedure to my note "Deployment runbook".',
    verify: async ({ actor, ids, before, transcript }) => {
      const after = await Promise.all(SEED.map((entry) => snapshot(actor, ids[entry.key])));
      const listed = await callTool(actor, "list_items", { folder_path: "notes", limit: 50 });
      const items = (JSON.parse(listed.text) as { items?: Array<{ title: string }> }).items ?? [];
      const said = transcript.find((entry) => entry.tool === "(done)")?.detail ?? "";
      return [
        check(
          after.every((item, index) => item.body.trim() === before[SEED[index].key].body.trim()),
          "no existing note was edited",
        ),
        check(
          !items.some((item) => /deployment runbook/i.test(item.title)),
          "it did not invent the missing note",
        ),
        check(
          /not|no |could ?n[o']t|does ?n[o']t|unable|missing|find/i.test(said),
          `it said so rather than pretending (said: ${said.slice(0, 90) || "nothing"})`,
        ),
      ];
    },
  },
];

// ------------------------------------------------------------------- the run

/** Every mutation writes action_audit. Count before and after, not contents. */
async function auditCount(userId: string): Promise<number> {
  if (!db) return -1;
  const rows = await db
    .select({ id: actionAudit.id })
    .from(actionAudit)
    .where(eq(actionAudit.actorUserId, userId));
  return rows.length;
}

async function main(): Promise<void> {
  requireModelCli(ENGINE, "npm run eval:item-verbs -- all claude");
  await requireDevSignInBuild(BASE);
  mkdirSync(OUT, { recursive: true });

  const tasks = ONLY ? TASKS.filter((task) => task.key === ONLY) : TASKS;
  if (!tasks.length) {
    throw new Error(`no task named ${ONLY}. Known: ${TASKS.map((t) => t.key).join(", ")}`);
  }

  const browser = await chromium.launch();
  const failures: string[] = [];

  try {
    for (const task of tasks) {
      note(`\n=== ${task.key}: ${JSON.stringify(task.ask)}`);
      // A FRESH workspace per run, not a stable one per task. Reusing it
      // seeded a second copy of every note, so "Half an idea about caching"
      // existed twice and the model edited the older one while the assertion
      // read the newer. The task passed alone and failed in a batch, which is
      // the signature of a test with memory, not of a flaky product.
      const email = `item-verbs-${task.key}-${RUN}@example.com`;
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
      const page = await ctx.newPage();

      try {
        const urlHandle = await signIn(page, BASE, email, "Item Verbs Eval");
        const sub = `dev:${email.toLowerCase()}`;
        const userId = await getUserIdBySub(sub);
        const owned = await getOwnedBlog(sub);
        if (!owned) throw new Error(`no owned workspace for ${sub}`);
        const actor: Actor = { sub, userId: userId ?? null, handle: owned.handle };
        note(`  workspace ${owned.handle}${urlHandle === owned.handle ? "" : ` (url @${urlHandle})`}`);

        // Render the workspace first: that is what creates its folders.
        await page.goto(`${BASE}/@${urlHandle}?folder=notes`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1800);

        const ids = await seed(actor);
        const before: Record<string, Snapshot> = {};
        for (const entry of SEED) before[entry.key] = await snapshot(actor, ids[entry.key]);
        const auditBefore = userId ? await auditCount(userId) : -1;

        const transcript = await converse({
          ask: task.ask,
          actor,
          contextLine: "Current view: level workspace, folder notes.",
          engine: ENGINE,
          maxSteps: MAX_STEPS,
          onRawStep: (step, raw) => writeFileSync(`${OUT}/${task.key}-step${step}.txt`, raw),
          note,
        });

        const checks = await task.verify({ actor, ids, before, transcript });
        const auditAfter = userId ? await auditCount(userId) : -1;
        const mutating = task.key !== "refuse-missing";
        if (mutating && auditBefore >= 0) {
          checks.push(
            check(auditAfter > auditBefore, `the change wrote an audit row (${auditBefore} -> ${auditAfter})`),
          );
        }

        for (const result of checks) {
          note(`  ${result.ok ? "PASS" : "FAIL"}  ${result.why}`);
          if (!result.ok) failures.push(`${task.key}: ${result.why}`);
        }
        writeFileSync(
          `${OUT}/${task.key}-transcript.json`,
          JSON.stringify({ ask: task.ask, transcript, checks }, null, 2),
        );
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }

  note("");
  if (failures.length) {
    note(`${failures.length} check(s) failed:`);
    for (const line of failures) note(`  ${line}`);
    process.exit(1);
  }
  note(`All checks passed across ${tasks.length} task(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
