// Live proof for the writing surface: syntax on the line you are on, and the
// agent's character offsets still landing while you type.
//
//   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000 npm run dev
//   npm run eval:markdown-surface
//
// Two things here would break silently, and neither shows up in a unit test.
//
// The first is the visible one. Markers are HIDDEN, not removed: they stay in
// the DOM so textContent is exactly the source. If a future change removes
// them instead, the document still looks right and every character offset in
// the product moves, which is the worst possible way for this to fail.
//
// The second is the one at real risk. The agent edits by character range
// (update_item text_edit, checked against expected_text inside the Yjs
// transaction), so an offset that moved by one breaks the agent's editing
// contract while the editor looks perfect. This lands an edit WHILE the caret
// is in the body and checks the result against the exact source.

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
const SHOTS = process.env.SHOT_DIR ?? "/tmp/texttext-markdown-surface";
const WHO = { email: "markdown-surface-aug27@example.com", name: "Surface" };

const BODY = [
  "## What to Create",
  "",
  "Build a WebMCP-powered web app.",
  "",
  "## Functionality",
  "",
  "- Be installable.",
].join("\n");

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

/** Start from nothing: the same title twice collides on its slug. */
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
    .where(and(eq(posts.blogId, identity.blogId), eq(posts.title, "Surface check")));
  const ids = stale.map((row) => row.id);
  if (ids.length === 0) return;
  await executeAtomicBatch((executor) => [
    executor.delete(collabPresence).where(inArray(collabPresence.postId, ids)),
    executor.delete(collabUpdates).where(inArray(collabUpdates.postId, ids)),
    executor.delete(collabState).where(inArray(collabState.postId, ids)),
    executor.delete(posts).where(inArray(posts.id, ids)),
  ]);
  console.log(`    (cleared ${ids.length} note(s) from a previous run)`);
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

/** Create the note through the same command surface every client uses. */
async function createNote(page: Page, handle: string): Promise<string> {
  const result = await page.evaluate(
    async ({ workspaceHandle, body }) => {
      const response = await fetch("/api/ai/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: workspaceHandle,
          name: "create_item",
          args: {
            kind: "note",
            title: "Surface check",
            body,
            idempotency_key: `surface-${Date.now()}`,
          },
        }),
      });
      return (await response.json()) as Record<string, unknown>;
    },
    { workspaceHandle: handle, body: BODY },
  );
  const structured = (result.result ??
    result.structuredContent ??
    result) as Record<string, unknown>;
  const item = (structured.item ?? {}) as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id : "";
  if (!id) throw new Error(`create_item gave no id: ${JSON.stringify(result).slice(0, 300)}`);
  return id;
}

/** Put the caret at an absolute character offset inside the body. */
async function caretTo(page: Page, offset: number) {
  await page.evaluate((at) => {
    const root = document.querySelector<HTMLElement>(
      '[role="textbox"][aria-label="Document body"]',
    );
    if (!root) throw new Error("no body surface");
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let total = 0;
    let node = walker.nextNode();
    while (node) {
      const length = node.textContent?.length ?? 0;
      if (total + length >= at) {
        const range = document.createRange();
        range.setStart(node, at - total);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        return;
      }
      total += length;
      node = walker.nextNode();
    }
  }, offset);
  await page.waitForTimeout(400);
}

/** What the surface is showing, and what it still contains. */
async function surface(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(
      '[role="textbox"][aria-label="Document body"]',
    );
    if (!root) return null;
    const syntax = [...root.querySelectorAll<HTMLElement>(".tt-md-syntax")];
    const listMarkers = [
      ...root.querySelectorAll<HTMLElement>(".tt-md-marker:not(.tt-md-syntax)"),
    ];
    return {
      source: root.textContent ?? "",
      visibleMarkers: syntax
        .filter((marker) => getComputedStyle(marker).display !== "none")
        .map((marker) => marker.textContent ?? ""),
      markerCount: syntax.length,
      // A list must still read as a list when the caret is elsewhere.
      visibleListMarkers: listMarkers
        .filter((marker) => getComputedStyle(marker).display !== "none")
        .map((marker) => marker.textContent ?? ""),
    };
  });
}

async function main() {
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

    const id = await createNote(page, handle);
    // Open it the way a person does: from the workspace, by name.
    await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
    await page
      .locator(".post-editor-content")
      .getByText("Surface check", { exact: true })
      .first()
      .click();
    await page.waitForTimeout(2500);
    const body = page.locator('[role="textbox"][aria-label="Document body"]');
    await body.waitFor({ timeout: 20000 });

    // The caret is on the first heading: its syntax is the writer's business.
    await caretTo(page, 3);
    const onHeading = await surface(page);
    check(
      "the line being written shows its syntax",
      Boolean(onHeading?.visibleMarkers.some((text) => text.includes("#"))),
      JSON.stringify(onHeading?.visibleMarkers ?? []),
    );
    await page.screenshot({ path: `${SHOTS}/caret-on-heading.png` });

    // Move to a plain line. Every heading now reads as a heading.
    await caretTo(page, BODY.indexOf("Build a WebMCP") + 4);
    const offHeading = await surface(page);
    check(
      "syntax on other lines is out of the way",
      offHeading?.visibleMarkers.every((text) => !text.includes("#")) ?? false,
      JSON.stringify(offHeading?.visibleMarkers ?? []),
    );
    check(
      "the markers are hidden, not deleted",
      (offHeading?.markerCount ?? 0) > 0,
      `${offHeading?.markerCount ?? 0} markers in the DOM`,
    );
    check(
      "a list still reads as a list from across the document",
      offHeading?.visibleListMarkers.some((text) => text.includes("-")) ?? false,
      JSON.stringify(offHeading?.visibleListMarkers ?? []),
    );
    check(
      "the source is untouched by any of it",
      offHeading?.source === BODY,
      JSON.stringify(offHeading?.source ?? "").slice(0, 160),
    );
    await page.screenshot({ path: `${SHOTS}/caret-off-heading.png` });

    // The agent edits by character range while the caret sits in the body.
    const start = BODY.indexOf("WebMCP-powered");
    const applied = await page.evaluate(
      async ({ workspaceHandle, itemId, from, to }) => {
        const response = await fetch("/api/ai/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            handle: workspaceHandle,
            name: "update_item",
            args: {
              id: itemId,
              text_edit: {
                field: "body",
                start: from,
                end: to,
                expected_text: "WebMCP-powered",
                replacement_text: "agent-powered",
              },
            },
          }),
        });
        return {
          status: response.status,
          body: (await response.text()).slice(0, 300),
        };
      },
      {
        workspaceHandle: handle,
        itemId: id,
        from: start,
        to: start + "WebMCP-powered".length,
      },
    );
    check(
      "an agent edit by character range is accepted while the caret is in the body",
      applied.status === 200 && !/error|isError/i.test(applied.body),
      `${applied.status} ${applied.body.slice(0, 160)}`,
    );

    await page.waitForTimeout(2500);
    const edited = await surface(page);
    check(
      "the edit landed exactly where the agent aimed",
      (edited?.source ?? "").includes("Build a agent-powered web app.") &&
        !(edited?.source ?? "").includes("WebMCP-powered"),
      JSON.stringify(edited?.source ?? "").slice(0, 200),
    );
    await page.screenshot({ path: `${SHOTS}/after-agent-edit.png` });
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
