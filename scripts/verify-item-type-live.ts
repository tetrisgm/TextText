// Exercise AI-assisted item-type creation in the running product.
//
//   npm run dev
//   npm run eval:item-type
//
// This is intentionally a browser evaluation, not a source assertion. It
// saves a complete starter type, applies it to a folder, creates a new item,
// edits its generated fields, and watches the item move on the rendered board.

import { chromium, type Page } from "playwright";
import { and, eq, inArray } from "drizzle-orm";
import { ITEM_TYPE_STARTERS } from "../src/lib/presentation/item-type-blueprint";
import {
  closeDatabaseConnections,
  db,
  executeAtomicBatch,
} from "../src/lib/db/client";
import {
  actionAudit,
  blogs,
  collabPresence,
  collabState,
  collabUpdates,
  documentTemplates,
  folders,
  posts,
  users,
} from "../src/lib/db/schema";

const BASE = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3000";
const RUN_ID = `${process.pid}-${Date.now().toString(36)}`;
const WHO = {
  email: `item-type-live-${RUN_ID}@example.com`,
  name: "Item type eval",
};
const FOLDER_NAME = `Item type eval ${RUN_ID}`;
let failures = 0;
let runBlogId: string | null = null;
let runFolderId: string | null = null;
let runUserId: string | null = null;

function check(claim: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok    ${claim}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${claim}${detail ? ` (${detail})` : ""}`);
  }
}

async function signIn(page: Page) {
  await page.goto(`${BASE}/editor`, { waitUntil: "domcontentloaded" });
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const form = page.locator("form.ac-devsignin");
    await form.waitFor({ timeout: 20_000 }).catch(() => undefined);
    if ((await form.count()) === 0) break;
    // A cold Next dev compile can paint the server markup several seconds
    // before React owns it. Keep this page mounted and retry the real submit;
    // navigating on every miss restarts hydration and can starve it forever.
    await page.waitForTimeout(1_000);
    await form.locator('input[type="email"]').fill(WHO.email);
    await form
      .locator('input[placeholder="Name (optional)"]')
      .first()
      .fill(WHO.name)
      .catch(() => undefined);
    const callback = page
      .waitForResponse(
        (response) => response.url().includes("/api/auth/callback/dev-login"),
        { timeout: 8_000 },
      )
      .catch(() => null);
    await form.locator('button[type="submit"]').click();
    if (!(await callback)) {
      console.log(`    (sign-in was not hydrated, retry ${attempt})`);
      continue;
    }
    await page.waitForTimeout(1_000);
    break;
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    if ((await page.locator(".workspace-library-header").count()) > 0) return;
  }
  const body = await page.locator("body").innerText().catch(() => "");
  throw new Error(
    `Workspace never loaded (last url ${page.url()}; body ${body.slice(0, 500)})`,
  );
}

function requireLocalDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const host = new URL(raw).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`item-type eval refuses non-local database host ${host}`);
  }
  if (!db) throw new Error("local database client is unavailable");
}

async function resolveRunWorkspace() {
  if (!db) throw new Error("local database client is unavailable");
  const [identity] = await db
    .select({ blogId: blogs.id, handle: blogs.handle, userId: users.id })
    .from(users)
    .innerJoin(blogs, eq(blogs.ownerId, users.id))
    .where(eq(users.email, WHO.email))
    .limit(1);
  if (!identity) throw new Error("the disposable workspace was not provisioned");
  runBlogId = identity.blogId;
  runUserId = identity.userId;
  return identity.handle;
}

async function createRunFolder(page: Page, handle: string) {
  const result = await page.evaluate(
    async ({ folderName, workspaceHandle }) => {
      const response = await fetch("/api/ai/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: workspaceHandle,
          name: "create_folder",
          args: { parent_path: "blog", name: folderName },
        }),
      });
      return {
        status: response.status,
        payload: (await response.json()) as {
          error?: string;
          result?: { folder?: { id?: string; path?: string } };
        },
      };
    },
    { folderName: FOLDER_NAME, workspaceHandle: handle },
  );
  const folder = result.payload.result?.folder;
  if (result.status !== 200 || !folder?.id || !folder.path) {
    throw new Error(
      `disposable folder creation failed (${result.status}): ${JSON.stringify(result.payload)}`,
    );
  }
  runFolderId = folder.id;
  return folder.path;
}

async function createPreviewItem(page: Page, handle: string, folderPath: string) {
  const result = await page.evaluate(
    async ({ workspaceHandle, targetFolder }) => {
      const response = await fetch("/api/ai/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: workspaceHandle,
          name: "create_item",
          args: {
            folder_path: targetFolder,
            kind: "article",
            title: "Preview source",
            body: "A disposable source document for the canonical folder preview.",
          },
        }),
      });
      return { status: response.status, body: await response.text() };
    },
    { targetFolder: folderPath, workspaceHandle: handle },
  );
  if (result.status !== 200) {
    throw new Error(
      `disposable preview creation failed (${result.status}): ${result.body.slice(0, 500)}`,
    );
  }
}

async function cleanupRunFixture() {
  if (!db || !runBlogId || !runUserId) return;
  const itemRows = runFolderId
    ? await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.blogId, runBlogId), eq(posts.folderId, runFolderId)))
    : [];
  const itemIds = itemRows.map((row) => row.id);
  const templateRows = await db
    .select({ id: documentTemplates.templateId })
    .from(documentTemplates)
    .where(
      and(
        eq(documentTemplates.blogId, runBlogId),
        eq(documentTemplates.createdById, runUserId),
      ),
    );
  const templateIds = templateRows.map((row) => row.id);

  await executeAtomicBatch((executor) => {
    const statements = [];
    if (itemIds.length > 0) {
      statements.push(
        executor.delete(collabPresence).where(inArray(collabPresence.postId, itemIds)),
        executor.delete(collabUpdates).where(inArray(collabUpdates.postId, itemIds)),
        executor.delete(collabState).where(inArray(collabState.postId, itemIds)),
        executor.delete(posts).where(inArray(posts.id, itemIds)),
      );
    }
    statements.push(
      executor.delete(actionAudit).where(eq(actionAudit.actorUserId, runUserId!)),
      executor
        .delete(documentTemplates)
        .where(
          and(
            eq(documentTemplates.blogId, runBlogId!),
            eq(documentTemplates.createdById, runUserId!),
          ),
        ),
    );
    if (runFolderId) {
      statements.push(executor.delete(folders).where(eq(folders.id, runFolderId)));
    }
    return statements;
  });

  const [remainingFolder] = runFolderId
    ? await db
        .select({ id: folders.id })
        .from(folders)
        .where(eq(folders.id, runFolderId))
        .limit(1)
    : [];
  const remainingTemplates = templateIds.length
    ? await db
        .select({ id: documentTemplates.templateId })
        .from(documentTemplates)
        .where(
          and(
            eq(documentTemplates.blogId, runBlogId),
            inArray(documentTemplates.templateId, templateIds),
          ),
        )
    : [];
  if (remainingFolder || remainingTemplates.length > 0) {
    throw new Error("item-type eval cleanup left database residue");
  }
  runFolderId = null;
}

async function openItemTypeStudio(page: Page) {
  const opener = page.locator(".workspace-build-type-button");
  const heading = page.getByRole("heading", { name: "What do you want to build?" });
  await opener.waitFor({ state: "visible", timeout: 20_000 });
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await opener.click();
    if (
      await heading
        .waitFor({ state: "visible", timeout: 2_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("the hydrated item-type studio opener never responded");
}

async function openRunFolder(page: Page) {
  const child = page.getByRole("button", { name: FOLDER_NAME, exact: true });
  if ((await child.count()) === 0) {
    const blogRow = page.locator(".post-editor-folder-row", {
      has: page.getByRole("button", { name: "Blog", exact: true }),
    });
    const expand = blogRow.getByRole("button", { name: "Expand", exact: true });
    if ((await expand.count()) > 0) await expand.click();
  }
  await child.waitFor({ state: "visible", timeout: 20_000 });
  await child.click();
}

async function main() {
  requireLocalDatabase();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const connectedAgentBlueprint = {
    ...structuredClone(ITEM_TYPE_STARTERS[0]!.blueprint),
    name: "AI reading list",
    description: "A reading list designed by the connected TextText Agent.",
  };
  await context.addInitScript(`(() => {
    const blueprint = ${JSON.stringify(connectedAgentBlueprint)};
    const state = { prompts: [], registeredTools: [], conversationId: undefined };
    const emit = (detail) => window.dispatchEvent(
      new CustomEvent("texttext:assistant", { detail })
    );
    Object.assign(window, {
      __TEXTTEXT_APP__: true,
      __TEXTTEXT_NATIVE_ITEM_TYPE_EVAL__: state,
      webkit: {
        messageHandlers: {
          textTextApp: {
            postMessage(message) {
              const body = message || {};
              if (body.action === "assistantTools") {
                state.registeredTools = (body.tools || []).map((tool) => tool.name || "");
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
                // Echo the conversation id back. Every native event is fenced
                // against the turn that asked for it, and the item-type design
                // turn runs in its own invisible conversation; an event without
                // the id is answered with "this turn is no longer active" and
                // the studio waits out its two-minute timeout.
                state.conversationId = body.conversationId;
                setTimeout(() => emit({
                  type: "tool-call",
                  callId: "item-type-preview",
                  tool: "preview_item_type",
                  arguments: { blueprint_json: JSON.stringify(blueprint) },
                  conversationId: state.conversationId
                }), 10);
              } else if (
                body.action === "assistantToolResult" &&
                body.callId === "item-type-preview"
              ) {
                setTimeout(() => emit({
                  type: "turn-completed",
                  conversationId: state.conversationId
                }), 10);
              }
            }
          }
        }
      }
    });
  })()`);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("browser page error", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("browser console error", message.text());
  });
  const itemTitle = `Launch checklist ${Date.now().toString(36)}`;

  try {
    await signIn(page);
    const handle = await resolveRunWorkspace();
    const runFolderPath = await createRunFolder(page, handle);
    await createPreviewItem(page, handle, runFolderPath);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".workspace-library-header").waitFor({ timeout: 20_000 });
    await openItemTypeStudio(page);
    check(
      "the focused builder opens from Home",
      (await page.getByRole("heading", { name: "What do you want to build?" }).count()) === 1,
    );
    check(
      "complete starters are available without a provider round trip",
      (await page.getByRole("button", { name: /Project board/ }).count()) === 1,
    );

    await page
      .getByPlaceholder(/A reading list with author/)
      .fill("A Medium-like reading list with author, status, and rating");
    await page.getByRole("button", { name: "Build this item type" }).click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .waitFor({ timeout: 20_000 })
      .catch(async (error) => {
        // A bare "waiting for Name" tells nobody why. Say what the studio is
        // showing instead, which is where the agent's own message lands.
        const shown = await page
          .locator('[role="dialog"]')
          .innerText()
          .catch(() => "(no dialog)");
        // Whether the turn was ever POSTED separates "the fake bridge never
        // looked connected" from "it connected and the reply was refused".
        const bridge = await page.evaluate(() => {
          const state = (
            window as unknown as {
              __TEXTTEXT_NATIVE_ITEM_TYPE_EVAL__?: {
                prompts: string[];
                registeredTools: string[];
              };
            }
          ).__TEXTTEXT_NATIVE_ITEM_TYPE_EVAL__;
          return {
            prompts: state?.prompts.length ?? -1,
            tools: state?.registeredTools.length ?? -1,
          };
        });
        throw new Error(
          `${(error as Error).message}\n\nturns posted to the fake bridge: ${bridge.prompts}, tools registered: ${bridge.tools}\n\nThe studio is showing:\n${shown.slice(0, 400)}`,
        );
      });
    check(
      "the focused builder uses the connected Codex or ChatGPT agent without an API key",
      (await page
        .getByRole("textbox", { name: "Name", exact: true })
        .inputValue()) ===
        "AI reading list",
    );
    const nativeProof = await page.evaluate(() => {
      const state = (
        window as Window & {
          __TEXTTEXT_NATIVE_ITEM_TYPE_EVAL__?: {
            prompts: string[];
            registeredTools: string[];
          };
        }
      ).__TEXTTEXT_NATIVE_ITEM_TYPE_EVAL__;
      return state ?? { prompts: [], registeredTools: [] };
    });
    check(
      "the native agent receives a preview-only tool and no direct save instruction",
        nativeProof.registeredTools.includes("preview_item_type") &&
        nativeProof.prompts.some(
          (prompt) =>
            prompt.includes("quality review rejects the design") &&
            prompt.includes("call it again") &&
            prompt.includes("Do not call any other tool"),
        ),
    );
    await page.getByRole("button", { name: "Back", exact: true }).click();

    await page.getByRole("button", { name: /Project board/ }).click();
    check(
      "item and folder previews are both present",
      (await page.getByRole("tab", { name: "Item" }).count()) === 1 &&
        (await page.getByRole("tab", { name: "Folder" }).count()) === 1,
    );
    check(
      "the studio exposes reversible history, responsive previews, and quality preflight",
      (await page.getByRole("combobox", { name: "Design version" }).count()) === 1 &&
        (await page.getByRole("group", { name: "Preview device" }).count()) === 1 &&
        (await page.getByRole("combobox", { name: "Preview content" }).count()) === 1 &&
        (await page.locator("details").filter({ hasText: /Ready|suggestion|attention/ }).count()) === 1,
    );
    const nameField = page.getByRole("textbox", { name: "Name", exact: true });
    await nameField.fill("Project tasks revised");
    await nameField.fill("Project tasks");
    await page.getByRole("button", { name: "Compare" }).click();
    check(
      "a refinement can be compared with its prior version",
      (await page.getByText("Before", { exact: true }).count()) === 1 &&
        (await page.getByText("Current", { exact: true }).count()) === 1,
    );
    await page.getByRole("button", { name: "Compare" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    check(
      "undo and redo move between complete designs",
      await page.getByRole("button", { name: "Redo" }).isEnabled(),
    );
    await page.getByRole("button", { name: "Redo" }).click();
    await page.getByRole("combobox", { name: "Preview content" }).selectOption("stress");
    await page.getByRole("button", { name: "Phone" }).click();
    check(
      "stress content can be inspected in a phone frame",
      (await page.getByRole("button", { name: "Phone" }).getAttribute("aria-pressed")) === "true" &&
        (await page.getByRole("combobox", { name: "Preview content" }).inputValue()) === "stress",
    );
    await page.getByRole("combobox", { name: "Preview content" }).selectOption("sample");
    await page.getByRole("button", { name: "Wide" }).click();
    await page
      .getByRole("combobox", { name: "Use in folder" })
      .selectOption({ label: FOLDER_NAME });
    await page.getByRole("combobox", { name: "Preview content" }).selectOption("folder");
    check(
      "the preview can use canonical documents from the selected folder",
      (await page.getByRole("combobox", { name: "Preview content" }).inputValue()) === "folder",
    );
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached", timeout: 20_000 });

    await openRunFolder(page);
    const composer = page.getByRole("textbox", { name: "Create an item" });
    await composer.fill(itemTitle);
    await composer.press("Enter");
    await page.getByRole("button", { name: "Look Project tasks" }).waitFor({ timeout: 20_000 });
    check(
      "a new folder item inherits the generated type",
      (await page.getByRole("combobox", { name: "Status" }).count()) === 1 &&
        (await page.getByRole("combobox", { name: "Priority" }).count()) === 1 &&
        (await page.getByRole("textbox", { name: "Due" }).count()) === 1,
    );
    check(
      "internal template fields stay out of the editor",
      (await page.getByRole("textbox", { name: "Type icon" }).count()) === 0,
    );
    await page.locator(".tt-save-state", { hasText: "Saved" }).waitFor({ timeout: 10_000 });
    // Let the initial collaboration catch-up and Strict Mode remount settle.
    // The checks below are about durable field behavior, not startup timing.
    await page.waitForTimeout(1200);

    const statusInput = page.getByRole("combobox", { name: "Status" });
    const peoplePicker = page.locator(".tt-people-picker");
    check(
      "people fields use the workspace-backed picker with a manual fallback",
      (await peoplePicker.count()) === 1 &&
        (await peoplePicker.getByText("Choose people", { exact: true }).count()) === 1 &&
        (await peoplePicker.getByText("Use an ID instead", { exact: true }).count()) === 1,
    );
    await peoplePicker.getByText("Choose people", { exact: true }).click();
    const personOptions = peoplePicker.locator('.tt-people-options [role="option"]');
    check(
      "the people picker offers canonical workspace items",
      (await personOptions.count()) > 0,
    );
    const selectedPerson = await personOptions.first().locator("strong").innerText();
    await personOptions.first().click();
    check(
      "a workspace item becomes a removable person chip",
      (await peoplePicker.getByRole("button", { name: `Remove ${selectedPerson}` }).count()) === 1,
    );
    await page.waitForTimeout(800);
    await page.locator(".tt-save-state", { hasText: "Saved" }).waitFor({ timeout: 10_000 });
    check(
      "a selected workspace person survives materialization",
      (await peoplePicker.getByRole("button", { name: `Remove ${selectedPerson}` }).count()) === 1,
    );
    const hideAssistant = page.getByRole("button", { name: "Hide assistant" });
    if ((await hideAssistant.count()) > 0) await hideAssistant.click();

    await page.screenshot({ path: "/tmp/texttext-advanced-fields-light.png", fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(150);
    if ((await peoplePicker.locator("details.tt-people-picker-menu[open]").count()) === 0) {
      await peoplePicker.locator("details.tt-people-picker-menu > summary").click();
    }
    await page.screenshot({ path: "/tmp/texttext-advanced-fields-dark.png", fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(150);
    await peoplePicker.scrollIntoViewIfNeeded();
    if ((await peoplePicker.locator("details.tt-people-picker-menu[open]").count()) === 0) {
      await peoplePicker.locator("details.tt-people-picker-menu > summary").click();
    }
    const narrowGeometry = await peoplePicker.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const popover = element.querySelector<HTMLElement>(".tt-people-picker-popover")?.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        popoverLeft: popover?.left ?? null,
        popoverRight: popover?.right ?? null,
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    await page.screenshot({ path: "/tmp/texttext-advanced-fields-narrow.png", fullPage: true });
    check(
      "people and workflow controls stay inside a narrow editor without horizontal overflow",
      narrowGeometry.left >= 0 &&
        narrowGeometry.right <= narrowGeometry.viewport &&
        narrowGeometry.popoverLeft !== null &&
        narrowGeometry.popoverLeft >= 0 &&
        narrowGeometry.popoverRight !== null &&
        narrowGeometry.popoverRight <= narrowGeometry.viewport &&
        narrowGeometry.scrollWidth <= narrowGeometry.viewport,
      JSON.stringify(narrowGeometry),
    );
    await page.setViewportSize({ width: 1440, height: 940 });
    await page.emulateMedia({ colorScheme: "light" });

    if ((await statusInput.inputValue()) === "") {
      await statusInput.selectOption({ value: "not-started" });
    }
    await statusInput.selectOption({ label: "Done" });
    const doneOptions = await statusInput.locator("option").allTextContents();
    check(
      "workflow status keeps the current value and offers only valid next states",
      (await statusInput.inputValue()) === "done" &&
        doneOptions.includes("Done") &&
        doneOptions.includes("In progress") &&
        !doneOptions.includes("Not started"),
      doneOptions.join(", "),
    );
    await statusInput.selectOption({ label: "In progress" });
    await page.getByRole("combobox", { name: "Priority" }).selectOption({ label: "High" });
    await page.locator(".tt-save-state", { hasText: "Saved" }).waitFor({ timeout: 10_000 });
    await openRunFolder(page);
    await page.waitForTimeout(1000);
    const board = page.getByRole("listbox", { name: "Folder board" });
    await board.waitFor({ timeout: 20_000 });
    const boardText = await board.innerText();
    check(
      "the saved folder renders the requested status board",
      ["Not started", "In progress", "Done"].every((label) => boardText.includes(label)),
      boardText.slice(0, 100),
    );
    const progressColumn = page.getByRole("region", { name: "In progress" });
    check(
      "editing a generated property moves the item on the live board",
      (await progressColumn.innerText()).includes(itemTitle),
    );

    const folderOptions = page.getByRole("button", {
      name: `Folder options for ${FOLDER_NAME}`,
    });
    await folderOptions.hover({ force: true });
    await folderOptions.click({ force: true });
    const changeLook = page.locator('button:text-is("Change look")').first();
    await changeLook.waitFor({ state: "visible", timeout: 10_000 });
    await changeLook.click();
    const gallery = page.getByRole("dialog").first();
    await gallery.waitFor({ timeout: 20_000 });
    check(
      "the generated type is reusable from the look gallery",
      (await gallery.getByText("Project tasks", { exact: true }).count()) > 0,
    );
  } finally {
    await browser.close();
    await cleanupRunFixture();
    await closeDatabaseConnections();
  }

  console.log(failures === 0 ? "\npass" : `\n${failures} behavior(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
