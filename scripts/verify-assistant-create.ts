// Live proof that the assistant can make the item you asked for.
//
//   node scripts/mock-ai-provider.mjs &
//   TEXTTEXT_AI_BASE_URL=http://localhost:3999/v1 npm run dev
//   npm run eval:assistant-create
//
// This is the DETERMINISTIC provider lane. The model's part is fixed: it names
// a kind and says nothing about a folder, which is what a real model does when
// the person did not name one. What is under test is everything after that.
//
// The workspace used to answer such a request with "Kind note does not belong
// in blog", because two separate layers wrote "blog" into the destination
// before anything looked at the kind. The item now goes to the folder its kind
// belongs in, and this watches each one land there in the workspace itself.
//
// A cloud write is a PROPOSAL, by design: the model stages the exact arguments
// and the owner approves them in the rail. So this drives the whole flow the
// person drives, ask then Apply change, and only then looks for the item.

import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { and, eq, inArray, like, or } from "drizzle-orm";
import {
  closeDatabaseConnections,
  db,
  executeAtomicBatch,
} from "../src/lib/db/client";
import {
  blogs,
  collabPresence,
  collabState,
  collabUpdates,
  documentTemplates,
  folders,
  idempotencyKeys,
  posts,
  users,
} from "../src/lib/db/schema";

const BASE = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/texttext-assistant-create";
const WHO = { email: "assistant-create-aug26@example.com", name: "Create" };

type Case = {
  /** What the person asks for. */
  ask: string;
  /** The collection it must land in, by its sidebar name. */
  collection: string;
  /** The title the model gives it. */
  title: string;
};

/**
 * The owner's own words, verbatim, from the screenshot that started this.
 *
 * The workspace answered it with "Couldn't create the note: the Blog folder
 * accepts articles, media posts, or video posts, not notes." The prompt is
 * kept exactly as it was pasted, em dash and all, because a regression test
 * that paraphrases the report is testing something the person never sent.
 */
const OWNERS_NOTE_PROMPT = `Create a note about:

Project Requirements

What to Create: Build a WebMCP-powered web app that imagines and explores the future of the open web—where humans and agents can interact, collaborate, and create together.
Functionality: The Project must be capable of being successfully installed and running consistently on the platform for which it is intended and must function as depicted in the video and/or expressed in the text description.
Platforms: A submitted Project must run on the platform for which it is intended and which is specified in the Submission Requirements.
New & Existing: Projects must be either newly created during the Hackathon Submission Period or, if the Project existed prior to the Submission Period, must have been meaningfully extended using WebMCP after the Submission Period start date. Pre-existing Projects will be evaluated only on work added during the Submission Period.
Entrants with pre-existing Projects must provide clear documentation distinguishing prior work from new work, including evidence that it was meaningfully extended with WebMCP within the Submission Period (e.g., timestamped, dated commit history, or equivalent).
Third Party Integrations: If a Project integrates any third-party SDK, APIs and/or data, Entrant must be authorized to use them in accordance with any terms and conditions or licensing requirements of the tool.`;

const CASES: Case[] = [
  {
    ask: OWNERS_NOTE_PROMPT,
    collection: "Notes",
    title: "Project requirements",
  },
  {
    ask: "Save a bookmark for the quiet tools reader",
    collection: "Bookmarks",
    title: "The quiet tools reader",
  },
  {
    ask: "Write an article about tools that recede",
    collection: "Blog",
    title: "Tools that recede",
  },
];

/** Where the mock puts the described type, so the eval can clean and check it. */
const READING_LOG_PATH = "blog/reading-log";
const READING_LOG_NAME = "Reading log";

/** The keys the mock provider stages its creates under. */
const MOCK_KEYS = [
  "mock-create-note",
  "mock-create-bookmark",
  "mock-create-article",
  "mock-create-reading-entry",
];

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

function requireLocalDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const host = new URL(raw).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`assistant-create eval refuses non-local database host ${host}`);
  }
  if (!db) throw new Error("local database client is unavailable");
}

/**
 * Start from nothing.
 *
 * The eval signs in as the same person every run, so an item left by the last
 * run would answer "it landed in Notes" without this run creating anything.
 * The idempotency claims go too: a reused key hands back the original item
 * instead of making one, which would be the same false pass by another route.
 */
async function startClean(email: string) {
  if (!db) return;
  const [identity] = await db
    .select({ blogId: blogs.id })
    .from(users)
    .innerJoin(blogs, eq(blogs.ownerId, users.id))
    .where(eq(users.email, email))
    .limit(1);
  if (!identity) return;
  const titles = [...CASES.map((testCase) => testCase.title), "Piranesi"];
  // The reading log is created by name every run, so the folders pile up as
  // reading-log-2, -3, -4 and the mock's fixed path stops meaning this run's
  // folder. Take the folders and the item types with the items.
  const staleFolders = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.blogId, identity.blogId),
        like(folders.path, `${READING_LOG_PATH}%`),
      ),
    );
  const staleFolderIds = staleFolders.map((row) => row.id);
  const stale = await db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.blogId, identity.blogId),
        staleFolderIds.length > 0
          ? or(
              inArray(posts.title, titles),
              inArray(posts.folderId, staleFolderIds),
            )
          : inArray(posts.title, titles),
      ),
    );
  const staleIds = stale.map((row) => row.id);
  const staleTemplates = await db
    .select({ templateId: documentTemplates.templateId })
    .from(documentTemplates)
    .where(
      and(
        eq(documentTemplates.blogId, identity.blogId),
        eq(documentTemplates.name, READING_LOG_NAME),
      ),
    );
  await executeAtomicBatch((executor) => {
    const statements = [];
    if (staleIds.length > 0) {
      statements.push(
        executor.delete(collabPresence).where(inArray(collabPresence.postId, staleIds)),
        executor.delete(collabUpdates).where(inArray(collabUpdates.postId, staleIds)),
        executor.delete(collabState).where(inArray(collabState.postId, staleIds)),
        executor.delete(posts).where(inArray(posts.id, staleIds)),
      );
    }
    if (staleFolderIds.length > 0) {
      statements.push(
        executor.delete(folders).where(inArray(folders.id, staleFolderIds)),
      );
    }
    if (staleTemplates.length > 0) {
      statements.push(
        executor
          .delete(documentTemplates)
          .where(
            and(
              eq(documentTemplates.blogId, identity.blogId),
              inArray(
                documentTemplates.templateId,
                staleTemplates.map((row) => row.templateId),
              ),
            ),
          ),
      );
    }
    statements.push(
      executor
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.blogId, identity.blogId),
            inArray(
              idempotencyKeys.key,
              MOCK_KEYS.map((key) => `agent:create:${key}`),
            ),
          ),
        ),
    );
    return statements;
  });
  console.log(
    `    (cleared ${staleIds.length} item(s) and ${staleFolderIds.length} folder(s) from a previous run)`,
  );
}

async function devSignIn(page: Page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
    const form = page.locator("form.ac-devsignin");
    await form.waitFor({ timeout: 20000 }).catch(() => undefined);
    if ((await form.count()) === 0) return;
    await form.locator('input[type="email"]').fill(WHO.email);
    await form
      .locator('input[placeholder="Name (optional)"]')
      .first()
      .fill(WHO.name)
      .catch(() => undefined);
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(2500);
    await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    if (!page.url().includes("/signin")) return;
  }
  throw new Error("dev sign-in never took");
}

/** Point the workspace at the mock provider so the turn is repeatable. */
async function connectMockProvider(page: Page, handle: string) {
  await page.goto(`${BASE}/@${handle}?view=settings`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1500);
  const key = page.locator('input[placeholder="Paste a provider API key"]');
  if ((await key.count()) === 0) {
    console.log("    (provider already connected)");
    return;
  }
  await key.fill("sk-ant-mock-provider-key");
  await page.getByRole("button", { name: "Add key" }).click();
  await page.waitForTimeout(2500);
}

/** Ask, then wait for the turn to settle one way or the other. */
async function ask(page: Page, prompt: string): Promise<string> {
  await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  const composer = page.locator('textarea[aria-label="Message assistant"]');
  await composer.waitFor({ timeout: 20000 });
  await composer.fill(prompt);
  await composer.press("Enter");
  for (let waited = 0; waited < 40; waited += 1) {
    await page.waitForTimeout(500);
    const working = await page.locator('[role="log"] [role="status"]').count();
    if (working === 0 && waited > 4) break;
  }
  await page.waitForTimeout(1500);
  return (await page.locator('[role="log"]').innerText()).replace(/\s+/g, " ");
}

/**
 * Approve the staged write, the way the person does. Returns false when the
 * turn never staged one, which is itself the answer to whether the assistant
 * can make what was asked for.
 */
async function approveTheChange(page: Page): Promise<boolean> {
  const apply = page.getByRole("button", { name: "Apply change" }).first();
  if (
    !(await apply
      .waitFor({ state: "visible", timeout: 8000 })
      .then(() => true)
      .catch(() => false))
  ) {
    return false;
  }
  await apply.click();
  await page
    .getByRole("button", { name: "Apply change" })
    .first()
    .waitFor({ state: "detached", timeout: 20000 })
    .catch(() => undefined);
  await page.waitForTimeout(2000);
  return true;
}

/** Open a collection from the sidebar and read what is in it. */
async function collectionContents(
  page: Page,
  collection: string,
): Promise<string> {
  const destination = page
    .locator(".post-editor-sidebar button")
    .filter({ hasText: new RegExp(`^${collection}`) })
    .first();
  await destination.waitFor({ state: "attached", timeout: 20000 });
  await destination.evaluate((button) => (button as HTMLButtonElement).click());
  await page.waitForTimeout(1800);
  return (await page.locator(".post-editor-content").innerText()).replace(
    /\s+/g,
    " ",
  );
}

/**
 * "Any kind of item I describe."
 *
 * A described kind of thing is a folder, a saved item type wearing its look,
 * and then items inside it. All three steps are staged writes the person
 * approves. A real model chains them inside one turn; the mock answers one
 * tool per turn, so the eval asks three times and approves three times, which
 * is the same product flow with the person's hand on each step.
 */
async function describedTypeChain(page: Page) {
  const steps: Array<{ ask: string; label: string }> = [
    { ask: "Make me a reading log", label: "the folder is created" },
    {
      ask: "Give the reading log its own look",
      label: "the described type is saved and worn by the folder",
    },
    { ask: "Add Piranesi to the reading log", label: "an entry is created in it" },
  ];
  for (const step of steps) {
    const transcript = await ask(page, step.ask);
    check(
      `reading log: ${step.label} is staged`,
      /Waiting for your review/i.test(transcript),
      transcript.slice(-200),
    );
    check(
      `reading log: ${step.label}`,
      await approveTheChange(page),
      "no Apply change control appeared",
    );
    const applied = (await page.locator('[role="log"]').innerText()).replace(
      /\s+/g,
      " ",
    );
    check(
      `reading log: ${step.label} without an error`,
      !/could not be applied|could not be found|does not belong in/i.test(applied),
      applied.slice(-200),
    );
  }
  // A subfolder is not a sidebar destination, so open it by its path.
  const handle = /\/@([^/?#]+)/.exec(page.url())?.[1] ?? "";
  await page.goto(`${BASE}/@${handle}?folder=${READING_LOG_PATH}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1800);
  const contents = (await page.locator(".post-editor-content").innerText()).replace(
    /\s+/g,
    " ",
  );
  check(
    "reading log: the entry is in the folder the type governs",
    contents.includes("Piranesi") && contents.includes("Reading log"),
    contents.slice(0, 160),
  );
  await page.screenshot({ path: `${SHOTS}/reading-log.png` });
}

/**
 * The mock provider, or every turn answers "The assistant could not finish
 * that" and sixteen checks fail for a reason that has nothing to do with any
 * of them. The native lane needs no provider; this one does.
 */
async function requireMockProvider() {
  const reachable = await fetch("http://localhost:3999/v1/models/probe")
    .then(() => true)
    .catch(() => false);
  if (reachable) return;
  throw new Error(
    "No mock provider on :3999.\n" +
      "  node scripts/mock-ai-provider.mjs &\n" +
      "  TEXTTEXT_AI_BASE_URL=http://localhost:3999/v1 npm run dev",
  );
}

async function main() {
  await requireMockProvider();
  mkdirSync(SHOTS, { recursive: true });
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 940 },
  });
  const page = await context.newPage();

  try {
    await devSignIn(page);
    const handle = /\/@([^/?#]+)/.exec(page.url())?.[1] ?? "";
    check("signed in to a workspace", handle.length > 0, page.url());
    await startClean(WHO.email);
    await connectMockProvider(page, handle);

    await describedTypeChain(page);

    for (const testCase of CASES) {
      const transcript = await ask(page, testCase.ask);
      const label = testCase.ask.split("\n")[0].slice(0, 48);
      check(
        `"${label}" stages the change for review`,
        /Waiting for your review/i.test(transcript),
        transcript.slice(-200),
      );
      check(
        `${testCase.collection}: the staged change is not refused`,
        !/does not belong in|Nothing changed/i.test(transcript),
        transcript.slice(-200),
      );
      check(
        `${testCase.collection}: approving it applies the change`,
        await approveTheChange(page),
        "no Apply change control appeared",
      );
      const applied = (await page.locator('[role="log"]').innerText()).replace(
        /\s+/g,
        " ",
      );
      check(
        `${testCase.collection}: the applied change reports no error`,
        !/does not belong in|could not be applied|Nothing changed/i.test(applied),
        applied.slice(-200),
      );
      const contents = await collectionContents(page, testCase.collection);
      check(
        `it lands in ${testCase.collection}`,
        contents.includes(testCase.title),
        `${testCase.collection} holds: ${contents.slice(0, 120)}`,
      );
      await page.screenshot({
        path: `${SHOTS}/${testCase.collection.toLowerCase()}.png`,
      });
    }
  } finally {
    await browser.close();
    await closeDatabaseConnections();
  }

  console.log(
    "\nnot checked here, and checked elsewhere instead:\n" +
      "  the item-type studio and its starters -> npm run eval:item-type\n" +
      "  a refused command reaches the rail    -> npm run eval:turn-receipt\n" +
      "  which phrasings open the write tools  -> unit tests on the /api/ai route",
  );
  console.log(
    failures === 0 ? `\npass. screenshots in ${SHOTS}` : `\n${failures} check(s) failed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
