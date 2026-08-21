// Deterministic browser proof for the native TextText assistant bridge.
//
//   npm run eval:native-bridge
//
// The browser supplies the same WK message boundary as the Mac app. The mock
// App Server answers a workspace-index request directly, then requests one
// real read_item call and guarded text edits. The React assistant executes
// those calls through the session-authenticated /api/ai/tools route and
// returns assistantToolResult to the native boundary before the final answer
// is rendered. The harness owns an isolated dev server and a dedicated local
// database fixture, then removes the fixture and its audit/collaboration state
// on every exit path.

import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { chromium, type Page, type Response } from "playwright";
import { and, desc, eq } from "drizzle-orm";
import {
  closeDatabaseConnections,
  db,
  executeAtomicBatch,
} from "@/lib/db/client";
import {
  actionAudit,
  collabPresence,
  collabState,
  collabUpdates,
  posts,
} from "@/lib/db/schema";

const EXTERNAL_BASE = process.env.TEXTTEXT_BASE_URL;
const PORT = Number(process.env.TEXTTEXT_NATIVE_BRIDGE_PORT ?? 3317);
const BASE = EXTERNAL_BASE ?? `http://localhost:${PORT}`;
const DIST_DIR = ".texttext/native-bridge-eval";
const WHO = {
  email: "native-assistant-bridge-e2e@example.com",
  name: "Native assistant bridge",
};

type BridgeState = {
  prompts: string[];
  registeredTools: string[];
  toolCalls: Array<{ callId: string; id: string; tool: string }>;
  toolResults: Array<{
    callId: string;
    isError: boolean;
    output: Record<string, unknown> | null;
  }>;
  requestedEdit?: {
    id: string;
    field: "title" | "excerpt" | "body";
    start: number;
    end: number;
    expected_text: string;
    replacement_text: string;
  };
  requestedItemId?: string;
};

let failures = 0;
let server: ChildProcess | null = null;
let serverOutput = "";
let fixtureItemId: string | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function requireLocalDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const host = new URL(raw).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`native bridge eval refuses non-local database host ${host}`);
  }
  if (!db) throw new Error("local database client is unavailable");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/editor`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Still starting.
    }
    await sleep(500);
  }
  throw new Error(`owned server did not start\n${serverOutput.slice(-2_000)}`);
}

async function startServer() {
  if (EXTERNAL_BASE) return;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        TEXTTEXT_NEXT_DIST_DIR: DIST_DIR,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const capture = (chunk: Buffer) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-12_000);
  };
  server.stdout?.on("data", capture);
  server.stderr?.on("data", capture);
  await waitForServer();
}

async function stopServer() {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => server?.once("exit", () => resolve())),
      sleep(3_000),
    ]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  if (!EXTERNAL_BASE) {
    rmSync(DIST_DIR, { force: true, recursive: true });
  }
}

async function databaseItem(id: string) {
  if (!db) return null;
  return (
    await db
      .select({ body: posts.body, id: posts.id, title: posts.title })
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1)
  )[0] ?? null;
}

async function latestAiAudit(id: string) {
  if (!db) return null;
  return (
    await db
      .select({
        actionName: actionAudit.actionName,
        actorType: actionAudit.actorType,
        targetId: actionAudit.targetId,
      })
      .from(actionAudit)
      .where(
        and(
          eq(actionAudit.targetId, id),
          eq(actionAudit.actionName, "mcp.update_item"),
        ),
      )
      .orderBy(desc(actionAudit.createdAt))
      .limit(1)
  )[0] ?? null;
}

async function cleanupFixture() {
  if (!db || !fixtureItemId) return;
  const id = fixtureItemId;
  // The fixture is created through the product command, but teardown is
  // deliberately direct and exact. It runs even after a browser timeout and
  // removes both collaboration residue and the audits the proof generated.
  await executeAtomicBatch((executor) => [
    executor.delete(collabPresence).where(eq(collabPresence.postId, id)),
    executor.delete(collabUpdates).where(eq(collabUpdates.postId, id)),
    executor.delete(collabState).where(eq(collabState.postId, id)),
    executor.delete(posts).where(eq(posts.id, id)),
    executor.delete(actionAudit).where(eq(actionAudit.targetId, id)),
  ] as const);

  const [remainingPost] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  const [remainingAudit] = await db
    .select({ id: actionAudit.id })
    .from(actionAudit)
    .where(eq(actionAudit.targetId, id))
    .limit(1);
  if (remainingPost || remainingAudit) {
    throw new Error(`fixture cleanup left database residue for ${id}`);
  }
  fixtureItemId = null;
}

function check(claim: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${claim}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${claim}${detail ? ` (${detail})` : ""}`);
}

async function signIn(page: Page) {
  // The dev form is client-driven. A cold compile can paint its markup before
  // hydration, so a click is only accepted once the auth callback actually
  // crosses the network boundary.
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await page.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
    const form = page.locator("form.ac-devsignin");
    await form.waitFor({ timeout: 20_000 }).catch(() => undefined);
    if ((await form.count()) === 0) break;
    await form.locator('input[type="email"]').fill(WHO.email);
    await form
      .locator('input[placeholder="Name (optional)"]')
      .first()
      .fill(WHO.name);
    const callback = page
      .waitForResponse(
        (response) => response.url().includes("/api/auth/callback/dev-login"),
        { timeout: 5_000 },
      )
      .catch(() => null);
    await form.locator('button[type="submit"]').click();
    if (await callback) {
      await page.waitForTimeout(1_000);
      break;
    }
    if (attempt === 6) {
      throw new Error(
        `dev sign-in never reached its callback; server=${serverOutput.slice(-1_500)}`,
      );
    }
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.goto(`${BASE}/start?to=home`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1_200);
    if ((await page.locator(".workspace-library-header").count()) > 0) return;
  }
  const body = await page.locator("body").innerText().catch(() => "");
  throw new Error(
    `workspace never loaded (last url ${page.url()}; body ${body.slice(0, 500)})`,
  );
}

async function bridgeState(page: Page): Promise<BridgeState> {
  return page.evaluate(() => {
    const current = window as Window & {
      __TEXTTEXT_NATIVE_BRIDGE_EVAL__?: BridgeState;
    };
    if (!current.__TEXTTEXT_NATIVE_BRIDGE_EVAL__) {
      throw new Error("native bridge state was not installed");
    }
    return structuredClone(current.__TEXTTEXT_NATIVE_BRIDGE_EVAL__);
  });
}

async function until<T>(
  timeoutMs: number,
  probe: () => Promise<T | null | undefined | false>,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await sleep(250);
  }
  return null;
}

async function setRequestedEdit(
  page: Page,
  edit: NonNullable<BridgeState["requestedEdit"]>,
) {
  await page.evaluate((nextEdit) => {
    const current = window as Window & {
      __TEXTTEXT_NATIVE_BRIDGE_EVAL__?: BridgeState;
    };
    if (!current.__TEXTTEXT_NATIVE_BRIDGE_EVAL__) {
      throw new Error("native bridge state was not installed");
    }
    current.__TEXTTEXT_NATIVE_BRIDGE_EVAL__.requestedEdit = nextEdit;
  }, edit);
}

async function createFixture(page: Page, handle: string) {
  const result = await page.evaluate(
    async ({ workspaceHandle, title, body }) => {
      const response = await fetch("/api/ai/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: workspaceHandle,
          name: "create_item",
          args: { folder_path: "blog", kind: "article", title, body },
        }),
      });
      return {
        status: response.status,
        payload: (await response.json()) as {
          result?: { item?: { id?: string } };
          error?: string;
        },
      };
    },
    {
      workspaceHandle: handle,
      title: `Native bridge fixture ${process.pid}`,
      body:
        "This disposable document proves that a native assistant edit reaches the live editor and the local database.",
    },
  );
  const id = result.payload.result?.item?.id;
  if (result.status !== 200 || !id) {
    throw new Error(
      `fixture creation failed (${result.status}): ${JSON.stringify(result.payload)}`,
    );
  }
  fixtureItemId = id;
  return id;
}

async function setRequestedItem(page: Page, id: string) {
  await page.evaluate((itemId) => {
    const current = window as Window & {
      __TEXTTEXT_NATIVE_BRIDGE_EVAL__?: BridgeState;
    };
    if (!current.__TEXTTEXT_NATIVE_BRIDGE_EVAL__) {
      throw new Error("native bridge state was not installed");
    }
    current.__TEXTTEXT_NATIVE_BRIDGE_EVAL__.requestedItemId = itemId;
  }, id);
}

async function workspaceHandle(page: Page) {
  return until(20_000, () =>
    page.evaluate(() => {
      for (const entry of performance.getEntriesByType("resource")) {
        const url = new URL(entry.name);
        if (url.pathname !== "/api/workspace/changes") continue;
        const handle = url.searchParams.get("handle");
        if (handle) return handle;
      }
      return null;
    }),
  );
}

async function openEditor(page: Page, id: string) {
  const row = page.locator(`[data-workspace-post-id="${id}"]`).first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await row.locator(".workspace-item-option-main").click();
  await page.waitForTimeout(600);
  if ((await page.locator(".tt-document-editor").count()) === 0) {
    const edit = page.getByRole("link", { name: /^Edit$/ }).or(
      page.getByRole("button", { name: /^Edit$/ }),
    );
    await edit.first().click();
  }
  await page
    .locator(".tt-document-editor .tt-md-surface")
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
}

async function openAssistant(page: Page) {
  const composer = page.getByRole("textbox", { name: "Message assistant" });

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    if (await composer.isVisible().catch(() => false)) return composer;

    const sidebar = page.locator('[data-assistant-sidebar=""]').first();
    await sidebar.waitFor({ state: "attached", timeout: 20_000 });
    if ((await sidebar.getAttribute("data-state")) !== "hidden") {
      await page.waitForTimeout(150);
      continue;
    }

    // The initial workspace refresh can replace the complete sidebar subtree.
    // Resolve the launcher from the current subtree on every attempt so this
    // proof exercises the button a person can actually see, not a stale node.
    const launcher = sidebar.getByRole("button", {
      name: /Open assistant|Chat with Codex/,
    });
    await launcher
      .click({ timeout: 3_000 })
      .catch(() => undefined);
    await page.waitForTimeout(250);
  }

  const state = await page
    .locator('[data-assistant-sidebar=""]')
    .first()
    .getAttribute("data-state")
    .catch(() => null);
  throw new Error(`assistant did not open from the live launcher (state ${state})`);
}

async function editorBody(page: Page) {
  return page
    .locator(".tt-document-editor .tt-md-surface")
    .first()
    .evaluate((element) => element.textContent ?? "");
}

function guardedWord(body: string) {
  const match = /[A-Za-z]{4,}/.exec(body);
  if (!match || match.index === undefined) {
    throw new Error("the seeded item has no editable body word");
  }
  const replacement =
    match[0] === match[0].toUpperCase()
      ? match[0].toLowerCase()
      : match[0].toUpperCase();
  return {
    start: match.index,
    end: match.index + match[0].length,
    before: match[0],
    after: replacement,
  };
}

async function main() {
  console.log(`native assistant bridge: browser against ${BASE}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 940 },
  });
  await context.addInitScript(`(() => {
    const state = {
      prompts: [],
      registeredTools: [],
      toolCalls: [],
      toolResults: []
    };
    const emit = (detail, delay = 0) => setTimeout(() => {
      window.dispatchEvent(new CustomEvent("texttext:assistant", { detail }));
    }, delay);
    const firstIndexedItemId = (prompt) => {
      if (state.requestedItemId) return state.requestedItemId;
      const index = prompt.match(/<WORKSPACE_INDEX>\\n([\\s\\S]*?)\\n<\\/WORKSPACE_INDEX>/)?.[1] || "";
      return index.match(/(?:^|\\n)id: ([^\\n]+)/)?.[1]?.trim() || "";
    };
    const requestText = (prompt) => {
      const value = prompt.match(/<USER_REQUEST>\\n([\\s\\S]*?)\\n<\\/USER_REQUEST>/)?.[1] || "";
      return value.trim();
    };
    const postMessage = (message) => {
      const body = message && typeof message === "object" ? message : {};
      if (body.action === "assistantTools") {
        state.registeredTools = (body.tools || []).map((tool) => tool.name || "");
        return;
      }
      if (body.action === "assistantStatus") {
        emit({
          type: "status",
          state: "ready",
          kind: "native-codex",
          providerLabel: "Codex with ChatGPT",
          embeddedChatSupported: true
        });
        return;
      }
      if (body.action === "assistantTurn") {
        const prompt = typeof body.prompt === "string" ? body.prompt : "";
        state.prompts.push(prompt);
        const request = requestText(prompt);
        if (request === "Summarize what I have been working on recently.") {
          emit({
            type: "final-text",
            text: "Your recent TextText work is indexed and ready to continue."
          }, 5);
          emit({ type: "turn-completed" }, 10);
          return;
        }
        if (request === "Apply the deterministic guarded bridge edit.") {
          const edit = state.requestedEdit;
          if (!edit) {
            emit({ type: "error", message: "No deterministic edit was supplied." }, 5);
            return;
          }
          const callId = "guarded-native-edit-" + state.toolCalls.length;
          state.toolCalls.push({ callId, id: edit.id, tool: "update_item" });
          emit({
            type: "tool-call",
            callId,
            tool: "update_item",
            arguments: {
              id: edit.id,
              text_edit: {
                field: edit.field,
                start: edit.start,
                end: edit.end,
                expected_text: edit.expected_text,
                replacement_text: edit.replacement_text
              }
            }
          }, 5);
          return;
        }
        const id = firstIndexedItemId(prompt);
        const callId = "read-newest-item";
        state.toolCalls.push({ callId, id, tool: "read_item" });
        emit({
          type: "tool-call",
          callId,
          tool: "read_item",
          arguments: { id }
        }, 5);
        return;
      }
      if (body.action === "assistantToolResult") {
        const output = body.output && typeof body.output === "object" ? body.output : null;
        state.toolResults.push({
          callId: body.callId || "",
          isError: body.isError === true,
          output
        });
        if (String(body.callId || "").startsWith("guarded-native-edit-")) {
          if (body.isError || !output) {
            emit({ type: "error", message: "The guarded workspace edit failed." }, 5);
            return;
          }
          emit({ type: "final-text", text: "The guarded workspace edit is visible." }, 5);
          emit({ type: "turn-completed" }, 10);
          return;
        }
        if (body.callId !== "read-newest-item") return;
        if (body.isError || !output) {
          emit({ type: "error", message: "The workspace read failed." }, 5);
          return;
        }
        const title = typeof output.title === "string" ? output.title : "Untitled";
        const bodyText = typeof output.body === "string" ? output.body.trim() : "";
        emit({
          type: "final-text",
          text: "I read \\\"" + title + "\\\" through the TextText workspace command. Its full body has " + bodyText.length + " characters."
        }, 5);
        emit({ type: "turn-completed" }, 10);
      }
    };
    Object.assign(window, {
      __TEXTTEXT_APP__: true,
      __TEXTTEXT_EMBEDDED_AGENT__: true,
      __TEXTTEXT_NATIVE_BRIDGE_EVAL__: state,
      webkit: { messageHandlers: { textTextApp: { postMessage } } }
    });
  })()`);

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(120_000);
  const toolResponses: Array<{ status: number; payload: unknown }> = [];
  page.on("pageerror", (error) =>
    console.error("browser page error", error.message),
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error("browser console error", message.text());
    }
  });
  page.on("response", (response: Response) => {
    if (
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/ai/tools"
    ) {
      void response
        .json()
        .then((payload) =>
          toolResponses.push({ status: response.status(), payload }),
        )
        .catch(() =>
          toolResponses.push({ status: response.status(), payload: null }),
        );
    }
  });

  try {
    await signIn(page);
    console.log("  stage signed in");
    const handle = await workspaceHandle(page);
    if (!handle) throw new Error(`workspace handle missing from ${page.url()}`);
    const dedicatedItemId = await createFixture(page, handle);
    await page.goto(`${BASE}/start?to=home`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".workspace-library-header").waitFor({ timeout: 20_000 });
    await setRequestedItem(page, dedicatedItemId);
    await page.waitForTimeout(100);
    toolResponses.length = 0;
    console.log("  stage disposable fixture ready");
    const composer = await openAssistant(page);
    await composer.waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          '[data-assistant-sidebar] textarea[aria-label="Message assistant"]',
        );
        return (
          Boolean(textarea) &&
          !textarea?.disabled &&
          textarea?.placeholder !== "Connect an AI to start"
        );
      },
      undefined,
      { timeout: 20_000 },
    );

    const summaryRequest = "Summarize what I have been working on recently.";
    await composer.fill(summaryRequest);
    await composer.press("Enter");
    await page
      .getByText("Your recent TextText work is indexed and ready to continue.", {
        exact: true,
      })
      .waitFor({ timeout: 20_000 });

    const afterSummary = await bridgeState(page);
    console.log("  stage summary complete");
    const summaryPrompt = afterSummary.prompts[0] ?? "";
    check(
      "the real browser emits a grounded native summary prompt",
      summaryPrompt.includes("<WORKSPACE_INDEX>") &&
        summaryPrompt.includes(`id: ${dedicatedItemId}`) &&
        summaryPrompt.includes(
          `<USER_REQUEST>\n${summaryRequest}\n</USER_REQUEST>`,
        ),
    );
    check(
      "the workspace-index summary completes without a tool call",
      afterSummary.toolCalls.length === 0,
      `${afterSummary.toolCalls.length} calls`,
    );
    check(
      "the native turn registers the actual workspace read tool",
      afterSummary.registeredTools.includes("read_item"),
    );

    await composer.fill(
      "Read the full newest workspace item, then tell me its title and body size.",
    );
    await composer.press("Enter");
    try {
      await page.waitForFunction(
        () => {
          const current = window as Window & {
            __TEXTTEXT_NATIVE_BRIDGE_EVAL__?: BridgeState;
          };
          return (
            current.__TEXTTEXT_NATIVE_BRIDGE_EVAL__?.toolResults.length ?? 0
          ) === 1;
        },
        undefined,
        { timeout: 20_000 },
      );
    } catch (error) {
      const stalled = await bridgeState(page);
      const body = await page.locator("body").innerText().catch(() => "");
      throw new Error(
        `tool result did not cross the bridge: ${JSON.stringify(stalled)}; page=${body.slice(-800)}; ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const returned = await bridgeState(page);
    if (returned.toolResults[0]?.isError) {
      throw new Error(
        `native tool failed: ${JSON.stringify(returned.toolResults[0]?.output)}`,
      );
    }
    await page
      .getByText(
        /I read ".+" through the TextText workspace command\. Its full body has \d+ characters\./,
      )
      .waitFor({ timeout: 20_000 });

    const completed = await bridgeState(page);
    console.log("  stage indexed read complete");
    const toolCall = completed.toolCalls[0];
    const toolResult = completed.toolResults[0];
    const routeResult = (
      toolResponses[0]?.payload as {
        result?: {
          item?: Record<string, unknown>;
          markdown?: unknown;
        };
      } | null
    )?.result;
    const routeItem = routeResult?.item;
    check(
      "the mocked App Server requests a realistic indexed item read",
      completed.toolCalls.length === 1 &&
        toolCall?.tool === "read_item" &&
        Boolean(toolCall?.id),
    );
    check(
      "the browser executes the tool through the real session route",
      toolResponses.length === 1 &&
        toolResponses[0]?.status === 200 &&
        routeItem?.id === toolCall?.id,
      `${toolResponses.length} responses, status ${toolResponses[0]?.status ?? "none"}, route id ${String(routeItem?.id ?? "none")}, call id ${toolCall?.id ?? "none"}`,
    );
    check(
      "assistantToolResult returns the local database document to native",
      toolResult?.callId === toolCall?.callId &&
        toolResult?.isError === false &&
        toolResult?.output?.id === routeItem?.id &&
        typeof toolResult?.output?.body === "string" &&
        typeof routeResult?.markdown === "string" &&
        routeResult.markdown.includes(
          String(toolResult.output.body).slice(0, 120),
        ),
      `tool id ${String(toolResult?.output?.id ?? "none")}, route id ${String(routeItem?.id ?? "none")}`,
    );
    check(
      "the native final answer is visible and the composer is ready again",
      await composer.isEnabled(),
    );

    const itemId = toolCall?.id ?? "";
    if (!itemId) throw new Error("the indexed item id was empty");
    if (itemId !== dedicatedItemId) {
      throw new Error(`native read escaped its disposable fixture: ${itemId}`);
    }
    await openEditor(page, itemId);
    console.log("  stage editor open");
    const original = await databaseItem(itemId);
    if (!original) throw new Error(`local database item ${itemId} disappeared`);
    const nativeEdit = guardedWord(original.body);
    const editedBody = `${original.body.slice(0, nativeEdit.start)}${nativeEdit.after}${original.body.slice(nativeEdit.end)}`;
    await setRequestedEdit(page, {
      id: itemId,
      field: "body",
      start: nativeEdit.start,
      end: nativeEdit.end,
      expected_text: nativeEdit.before,
      replacement_text: nativeEdit.after,
    });
    const beforeNativeResponses = toolResponses.length;
    const beforeNativeResults = (await bridgeState(page)).toolResults.length;
    await composer.fill("Apply the deterministic guarded bridge edit.");
    await composer.press("Enter");
    await page.waitForFunction(
      (count) => {
        const current = window as Window & {
          __TEXTTEXT_NATIVE_BRIDGE_EVAL__?: BridgeState;
        };
        return (
          (current.__TEXTTEXT_NATIVE_BRIDGE_EVAL__?.toolResults.length ?? 0) >
          count
        );
      },
      beforeNativeResults,
      { timeout: 20_000 },
    );
    const nativeDatabaseEdit = await until(20_000, async () => {
      const item = await databaseItem(itemId);
      return item?.body === editedBody ? item : null;
    });
    const nativeDomEdit = await until(20_000, async () =>
      (await editorBody(page)) === editedBody ? true : null,
    );
    const nativeRoute = toolResponses
      .slice(beforeNativeResponses)
      .find((entry) => {
        const payload = entry.payload as {
          result?: { item?: { id?: unknown } };
        } | null;
        return payload?.result?.item?.id === itemId;
      });
    const nativeAudit = await latestAiAudit(itemId);
    const afterNative = await bridgeState(page);
    console.log("  stage native edit complete");
    const nativeCall = afterNative.toolCalls.at(-1);
    const nativeResult = afterNative.toolResults.at(-1);
    check(
      "native update_item crosses the real session route with the matching id",
      nativeRoute?.status === 200 &&
        nativeCall?.tool === "update_item" &&
        nativeCall.id === itemId &&
        nativeResult?.callId === nativeCall.callId &&
        nativeResult.output?.id === itemId,
    );
    check(
      "the guarded native edit is visible in the live editor and local database",
      Boolean(nativeDomEdit && nativeDatabaseEdit),
    );
    check(
      "the native edit audit is attributed to AI",
      nativeAudit?.actorType === "ai" && nativeAudit.targetId === itemId,
      JSON.stringify(nativeAudit),
    );

    await setRequestedEdit(page, {
      id: itemId,
      field: "body",
      start: nativeEdit.start,
      end: nativeEdit.start + nativeEdit.after.length,
      expected_text: nativeEdit.after,
      replacement_text: nativeEdit.before,
    });
    const beforeRestoreResults = afterNative.toolResults.length;
    await composer.fill("Apply the deterministic guarded bridge edit.");
    await composer.press("Enter");
    await page.waitForFunction(
      (count) => {
        const current = window as Window & {
          __TEXTTEXT_NATIVE_BRIDGE_EVAL__?: BridgeState;
        };
        return (
          (current.__TEXTTEXT_NATIVE_BRIDGE_EVAL__?.toolResults.length ?? 0) >
          count
        );
      },
      beforeRestoreResults,
      { timeout: 20_000 },
    );
    await until(20_000, async () =>
      (await databaseItem(itemId))?.body === original.body ? true : null,
    );
    const restoreTurnReady = await until(20_000, async () =>
      (await composer.isEnabled()) ? true : null,
    );
    if (!restoreTurnReady) {
      throw new Error("the native restore turn did not release the composer");
    }

    const proposalEdit = guardedWord(original.body.slice(nativeEdit.end));
    proposalEdit.start += nativeEdit.end;
    proposalEdit.end += nativeEdit.end;
    const proposedBody = `${original.body.slice(0, proposalEdit.start)}${proposalEdit.after}${original.body.slice(proposalEdit.end)}`;
    const transcriptKey = await page.evaluate((id) =>
      Object.keys(sessionStorage).find((key) =>
        key.endsWith(`:item:${id}`),
      ), itemId);
    if (!transcriptKey) {
      throw new Error("the open-item assistant transcript was not persisted");
    }
    await page.evaluate(
      ({ key, id, body, edit }) => {
        const existing = JSON.parse(sessionStorage.getItem(key) ?? "[]") as unknown[];
        existing.push({
          id: "guarded-selection-proposal",
          role: "assistant",
          text: "A guarded selection edit is ready.",
          provider: "OpenAI",
          proposal: {
            itemId: id,
            label: "Guarded selection edit",
            canApply: true,
            status: "pending",
            kind: "text",
            field: "body",
            before: edit.before,
            after: edit.after,
            source: body,
            result:
              body.slice(0, edit.start) +
              edit.after +
              body.slice(edit.end),
            range: { start: edit.start, end: edit.end },
            scope: "selection",
          },
        });
        sessionStorage.setItem(key, JSON.stringify(existing));
      },
      { key: transcriptKey, id: itemId, body: original.body, edit: proposalEdit },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await openAssistant(page);
    console.log("  stage proposal restored");
    await page
      .locator(".tt-document-editor .tt-md-surface")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
    const proposal = page.getByText("Guarded selection edit", { exact: true });
    await proposal.waitFor({ state: "visible", timeout: 20_000 });
    const beforeProposalResponses = toolResponses.length;
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.getByText("Applied", { exact: true }).waitFor({ timeout: 20_000 });
    const proposalDomEdit = await until(20_000, async () =>
      (await editorBody(page)) === proposedBody ? true : null,
    );
    const proposalDatabaseEdit = await until(20_000, async () =>
      (await databaseItem(itemId))?.body === proposedBody ? true : null,
    );
    const proposalRoute = toolResponses
      .slice(beforeProposalResponses)
      .find((entry) => {
        const payload = entry.payload as {
          result?: { item?: { id?: unknown } };
        } | null;
        return payload?.result?.item?.id === itemId;
      });
    const proposalAudit = await latestAiAudit(itemId);
    check(
      "accepting a selection proposal uses the shared AI command and is visible",
      proposalRoute?.status === 200 &&
        Boolean(proposalDomEdit && proposalDatabaseEdit),
    );
    check(
      "the accepted selection proposal audit is attributed to AI",
      proposalAudit?.actorType === "ai" && proposalAudit.targetId === itemId,
      JSON.stringify(proposalAudit),
    );

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByText("Undone", { exact: true }).waitFor({ timeout: 20_000 });
    const undoDom = await until(20_000, async () =>
      (await editorBody(page)) === original.body ? true : null,
    );
    const undoDatabase = await until(20_000, async () =>
      (await databaseItem(itemId))?.body === original.body ? true : null,
    );
    const undoAudit = await latestAiAudit(itemId);
    console.log("  stage proposal undo complete");
    check(
      "Undo restores both the live editor and local database",
      Boolean(undoDom && undoDatabase),
    );
    check(
      "Undo remains an audited AI workspace command",
      undoAudit?.actorType === "ai" && undoAudit.targetId === itemId,
      JSON.stringify(undoAudit),
    );
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    throw new Error(`${failures} native assistant bridge checks failed`);
  }
  console.log("native assistant bridge: all checks passed");
}

async function run() {
  requireLocalDatabase();
  try {
    await startServer();
    await main();
  } finally {
    try {
      await cleanupFixture();
    } finally {
      await stopServer();
      await closeDatabaseConnections().catch(() => undefined);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void cleanupFixture()
      .finally(stopServer)
      .finally(() => closeDatabaseConnections().catch(() => undefined))
      .finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}

void run().catch((error) => {
  const ownedServerLog = EXTERNAL_BASE
    ? ""
    : `\nowned server tail:\n${serverOutput.slice(-4_000)}`;
  console.error(
    `native assistant bridge: ${error instanceof Error ? error.stack ?? error.message : String(error)}${ownedServerLog}`,
  );
  process.exitCode = 1;
});
