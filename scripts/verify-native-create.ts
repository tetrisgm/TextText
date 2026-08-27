// Live proof that the CONNECTED AGENT can make the item you asked for.
//
//   npm run dev
//   npm run eval:native-create
//
// This is the native lane, and it is not the cloud one. The two differ in the
// way that matters here: a cloud write is staged as a proposal the owner
// approves, while the connected agent's tool call runs immediately through
// createWorkspaceAgentTools. They resolve a missing destination in separate
// code, so a routing fix in one proves nothing about the other.
//
// The owner's report was on THIS lane. The rail said "Chat with Codex" and the
// answer was labelled "Answered by OpenAI", which is what a native turn looks
// like, and their workspace has no write proposal rows at all because nothing
// on this path ever stages one. The cloud eval could not have caught it.
//
// No agent runs here. The bridge is faked the way scripts/verify-item-type-live.ts
// fakes it, which means it must echo the conversationId it is handed: every
// native event is fenced against the turn that asked for it.

import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
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
  posts,
  users,
} from "../src/lib/db/schema";

const BASE = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/texttext-native-create";
const WHO = { email: "native-create-aug27@example.com", name: "Native" };

/** The owner's own words, verbatim, from the report that started this. */
const OWNERS_PROMPT = `Create a note about:

Project Requirements

What to Create: Build a WebMCP-powered web app that imagines and explores the future of the open web—where humans and agents can interact, collaborate, and create together.
Functionality: The Project must be capable of being successfully installed and running consistently on the platform for which it is intended and must function as depicted in the video and/or expressed in the text description.`;

const NOTE_TITLE = "Project requirements";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
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
    throw new Error(`native-create eval refuses non-local database host ${host}`);
  }
  if (!db) throw new Error("local database client is unavailable");
}

/** Start from nothing, so "it landed" cannot be answered by a previous run. */
async function startClean(email: string) {
  if (!db) return;
  const [identity] = await db
    .select({ blogId: blogs.id })
    .from(users)
    .innerJoin(blogs, eq(blogs.ownerId, users.id))
    .where(eq(users.email, email))
    .limit(1);
  if (!identity) return;
  const stale = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.blogId, identity.blogId), eq(posts.title, NOTE_TITLE)));
  const ids = stale.map((row) => row.id);
  if (ids.length === 0) return;
  await executeAtomicBatch((executor) => [
    executor.delete(collabPresence).where(inArray(collabPresence.postId, ids)),
    executor.delete(collabUpdates).where(inArray(collabUpdates.postId, ids)),
    executor.delete(collabState).where(inArray(collabState.postId, ids)),
    executor.delete(posts).where(inArray(posts.id, ids)),
  ]);
  console.log(`    (cleared ${ids.length} item(s) from a previous run)`);
}

async function devSignIn(page: Page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
    const form = page.locator("form.ac-devsignin");
    await form.waitFor({ timeout: 20000 }).catch(() => undefined);
    if ((await form.count()) === 0) break;
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
    if (!page.url().includes("/signin")) break;
  }
}

/**
 * The connected agent, faked at the bridge.
 *
 * It answers the status handshake as a ready Codex connection, and when a turn
 * arrives it does the one thing the owner asked for: calls create_item with a
 * kind and NO folder_path, because the person never named a folder. Where that
 * lands is the workspace's decision, and it is the decision under test.
 */
function nativeBridge(): string {
  return `(() => {
    const state = { prompts: [], tools: [], conversationId: undefined, results: [] };
    const emit = (detail) => window.dispatchEvent(
      new CustomEvent("texttext:assistant", { detail })
    );
    Object.assign(window, {
      __TEXTTEXT_APP__: true,
      __TEXTTEXT_NATIVE_CREATE_EVAL__: state,
      webkit: {
        messageHandlers: {
          textTextApp: {
            postMessage(message) {
              const body = message || {};
              if (body.action === "assistantTools") {
                state.tools = (body.tools || []).map((tool) => tool.name || "");
              } else if (body.action === "assistantStatus") {
                queueMicrotask(() => emit({
                  type: "status",
                  state: "ready",
                  kind: "native-codex",
                  providerLabel: "Codex with ChatGPT",
                  embeddedChatSupported: true
                }));
              } else if (body.action === "assistantTurn") {
                state.prompts.push(body.prompt || "");
                state.conversationId = body.conversationId;
                setTimeout(() => emit({
                  type: "tool-call",
                  callId: "native-create-1",
                  tool: "create_item",
                  arguments: {
                    kind: "note",
                    title: ${JSON.stringify(NOTE_TITLE)},
                    body: "The project must install and run consistently on the platform it is intended for."
                  },
                  conversationId: state.conversationId
                }), 20);
              } else if (
                body.action === "assistantToolResult" &&
                body.callId === "native-create-1"
              ) {
                state.results.push({ isError: Boolean(body.isError), output: body.output });
                setTimeout(() => emit({
                  type: "final-text",
                  text: "Saved that as a note.",
                  conversationId: state.conversationId
                }), 20);
                setTimeout(() => emit({
                  type: "turn-completed",
                  conversationId: state.conversationId
                }), 40);
              }
            }
          }
        }
      }
    });
  })()`;
}

async function main() {
  requireLocalDatabase();
  mkdirSync(SHOTS, { recursive: true });
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 940 },
  });
  await context.addInitScript(nativeBridge());
  const page = await context.newPage();

  try {
    await devSignIn(page);
    const handle = /\/@([^/?#]+)/.exec(page.url())?.[1] ?? "";
    check("signed in to a workspace", handle.length > 0, page.url());
    await startClean(WHO.email);

    await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);

    const composer = page.locator('textarea[aria-label="Message assistant"]');
    await composer.waitFor({ timeout: 20000 });
    await composer.fill(OWNERS_PROMPT);
    await composer.press("Enter");

    for (let waited = 0; waited < 50; waited += 1) {
      await page.waitForTimeout(500);
      const working = await page.locator('[role="log"] [role="status"]').count();
      if (working === 0 && waited > 4) break;
    }
    await page.waitForTimeout(2000);

    const bridge = await page.evaluate(() => {
      const state = (
        window as unknown as {
          __TEXTTEXT_NATIVE_CREATE_EVAL__?: {
            prompts: string[];
            tools: string[];
            results: Array<{ isError: boolean; output: unknown }>;
          };
        }
      ).__TEXTTEXT_NATIVE_CREATE_EVAL__;
      return {
        prompts: state?.prompts.length ?? -1,
        offersCreate: state?.tools.includes("create_item") ?? false,
        results: state?.results ?? [],
      };
    });

    check(
      "the connected agent is offered create_item",
      bridge.offersCreate,
      `${bridge.prompts} turn(s) reached the bridge`,
    );
    check(
      "the turn reached the agent",
      bridge.prompts > 0,
      "no turn was posted to the bridge",
    );
    const firstResult = bridge.results[0];
    check(
      "the workspace accepted the create without naming a folder",
      Boolean(firstResult) && !firstResult.isError,
      firstResult
        ? JSON.stringify(firstResult.output).slice(0, 200)
        : "the agent never received a tool result",
    );

    const transcript = (await page.locator('[role="log"]').innerText()).replace(
      /\s+/g,
      " ",
    );
    // Not "the rail is free of error text": that passes when the create fails
    // and the agent says something cheerful, which is the failure this lane
    // shipped with. Tie the rail to what the command actually answered.
    const refused = Boolean(firstResult?.isError);
    check(
      refused
        ? "a refused command reaches the rail in its own words"
        : "the rail carries no refusal for a command that worked",
      refused
        ? /does not belong in/i.test(transcript)
        : !/does not belong in/i.test(transcript),
      transcript.slice(-200),
    );

    // Where it landed, read from the workspace and not from the reply.
    const notes = page
      .locator(".post-editor-sidebar button")
      .filter({ hasText: /^Notes/ })
      .first();
    await notes.waitFor({ state: "attached", timeout: 20000 });
    await notes.evaluate((button) => (button as HTMLButtonElement).click());
    await page.waitForTimeout(2000);
    const contents = (
      await page.locator(".post-editor-content").innerText()
    ).replace(/\s+/g, " ");
    check(
      "it lands in Notes",
      contents.includes(NOTE_TITLE),
      `Notes holds: ${contents.slice(0, 140)}`,
    );
    await page.screenshot({ path: `${SHOTS}/notes.png` });
  } finally {
    await browser.close();
    await closeDatabaseConnections();
  }

  console.log(
    failures === 0 ? `\npass. screenshots in ${SHOTS}` : `\n${failures} check(s) failed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
