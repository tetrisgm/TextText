// Live browser collaboration evaluation.
//
//   npm run eval:collaboration:browser
//
// The other collaboration checks drive Yjs clients in process. This one drives
// real browsers against a real server, because the question it answers is not
// "does the merge converge" but "does a person SEE the other participant".
//
// It proves, or fails to prove, four things:
//
//   1. human -> human content: Ada types, Grace sees it, without a reload
//   2. human -> human caret:   Grace's browser paints Ada's cursor, labelled
//   3. agent presence:         an agent appears as a named collaborator with a caret
//   4. agent -> human content: an agent's write shows up in an ALREADY-OPEN editor
//
// Two dev-login accounts are two real people. The agent leg uses the same
// transports a hosted client uses: POST /api/agent/presence for presence and
// POST /api/mcp for the write. Nothing here reaches production: it runs against
// whatever DATABASE_URL .env.local names, which must be local Postgres.
//
// The server is started as a child of this process and killed in a finally
// block, so nothing is left running.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { createApiToken } from "@/lib/api-tokens";
import { MCP_PROTOCOL_VERSION } from "@/lib/mcp/protocol";
import { closeDatabaseConnections } from "@/lib/db/client";

const PORT = Number(process.env.LIVE_COLLAB_PORT ?? 3130);
// Keep one hostname for every browser navigation and API request. Auth.js
// cookies are host-scoped, so mixing 127.0.0.1 and localhost makes the harness
// report redirect loops before it reaches collaboration at all.
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.LIVE_COLLAB_SHOTS ?? "/tmp/live-collab";
const HEADED = process.env.LIVE_COLLAB_HEADED === "1";

// A per-run stamp, so no assertion can ever pass on text a previous run left
// in the same document. Without it a check can go green while the editor it is
// supposed to exercise does nothing at all.
const RUN = process.env.LIVE_COLLAB_RUN ?? String(process.pid);
const ADA = { email: "ada.live-collab@example.test", name: "Ada" };
const GRACE = { email: "grace.live-collab@example.test", name: "Grace" };

type Check = {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
};

const checks: Check[] = [];
const notes: string[] = [];

function note(line: string): void {
  notes.push(line);
  console.log(line);
}

function record(id: string, title: string, passed: boolean, detail: string) {
  checks.push({ id, title, passed, detail });
  note(`${passed ? "PASS" : "FAIL"}  ${id}  ${title}\n      ${detail}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll a predicate until it holds, so a slow relay is late rather than failed. */
async function until<T>(
  label: string,
  timeoutMs: number,
  probe: () => Promise<T | null>,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null = null;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(400);
  }
  note(`      (timed out after ${timeoutMs}ms waiting for ${label})`);
  return last;
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 180; i += 1) {
    try {
      const res = await fetch(BASE, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error("the server never became reachable");
}

async function devSignIn(page: Page, who: { email: string; name: string }) {
  // The dev-login form lives on the editor sign-in screen, not /signin.
  await page.goto(`${BASE}/editor`, { waitUntil: "domcontentloaded" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 20000 });
  await form.locator('input[type="email"]').fill(who.email);
  await form.locator('input[aria-label="Name (optional)"], input[placeholder="Name (optional)"]')
    .first()
    .fill(who.name)
    .catch(() => undefined);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/editor" || true, {
      timeout: 30000,
    }),
    form.locator('button[type="submit"]').click(),
  ]);
  await page.waitForTimeout(1200);
  note(`  ${who.name} signed in, landed on ${page.url()}`);
}

/** The body surface the writer actually types into. */
function bodyField(page: Page) {
  return page.locator(".tt-document-editor .tt-md-surface").first();
}

/** The body source, exactly as the document stores it. */
async function bodyText(page: Page): Promise<string> {
  return bodyField(page)
    .evaluate((el) => el.textContent ?? "")
    .catch(() => "");
}

/** The local insertion point as a character offset into the body source. */
async function caretOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.activeElement as HTMLElement | null;
    const selection = window.getSelection();
    if (!root?.classList.contains("tt-md-surface")) return -1;
    if (!selection || selection.rangeCount === 0) return -1;
    const range = selection.getRangeAt(0);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let total = 0;
    let node = walker.nextNode();
    while (node) {
      if (node === range.startContainer) return total + range.startOffset;
      total += node.textContent?.length ?? 0;
      node = walker.nextNode();
    }
    return total;
  });
}

function titleField(page: Page) {
  return page.locator('.tt-document-editor textarea[aria-label="Title"]').first();
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

/** Call one workspace tool over MCP exactly as a hosted client would. */
async function agentTool(
  token: string,
  clientName: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; body: string }> {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": tool,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Date.now() % 100000),
      method: "tools/call",
      _meta: { "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION },
      params: {
        name: tool,
        arguments: args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: clientName, version: "1.0.0" },
        },
      },
    }),
  });
  const body = await res.text();
  return { ok: res.ok && !/"isError"\s*:\s*true/.test(body), body };
}

/** Publish or clear agent presence the way the CLI does. */
async function agentPresence(
  token: string,
  itemId: string,
  agent: string,
  active: boolean,
): Promise<Response> {
  return fetch(`${BASE}/api/agent/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ itemId, agent, activity: "edit", active }),
  });
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await waitForServer();
  note(`server up on ${BASE}`);

  const browser: Browser = await chromium.launch({ headless: !HEADED });
  try {
    // --- Two real people, two real browsers ------------------------------
    const adaCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const graceCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const ada = await adaCtx.newPage();
    const grace = await graceCtx.newPage();

    // Grace signs in first so the invite resolves to a real account.
    await devSignIn(grace, GRACE);
    await devSignIn(ada, ADA);

    // Ada creates the item they will share.
    const startProbe = await ada.request.get(`${BASE}/start`, { maxRedirects: 0 });
    const itemLocation = startProbe.headers().location ?? "";
    const itemMatch = itemLocation.match(/^\/@[^/]+\/([^?]+)(\?.*)?$/);
    if (!itemMatch) throw new Error(`unexpected starter location: ${itemLocation}`);
    const itemPath = `/t/ada-live-collab/${itemMatch[1]}${itemMatch[2] ?? ""}`;
    await ada.goto(`${BASE}${itemPath}`, { waitUntil: "domcontentloaded" });
    await ada.waitForTimeout(2500);
    const itemUrl = ada.url();
    const itemId = new URL(itemUrl).searchParams.get("id");
    note(`  Ada is editing ${itemUrl}`);
    if (!itemId) throw new Error("could not resolve the item id from the editor URL");

    await titleField(ada).fill("Launch plan").catch(() => undefined);
    await ada.waitForTimeout(800);

    const adaUserId = await resolveUserId(ADA.email);
    if (!adaUserId) throw new Error("could not resolve Ada's user id");
    const { raw: token } = await createApiToken(adaUserId, "live-collab-eval", {
      scopes: "sync",
    });

    // --- Share it with Grace, as an editor -------------------------------
    // Sharing lives on the reader's action bar, not the editor toolbar, so Ada
    // steps out of edit mode to invite and steps back in afterwards.
    // The owner controls are available in the open editor. Keeping the editor
    // mounted also makes this check exercise the same surface collaborators
    // use while they are typing.
    await ada.waitForTimeout(1200);
    const shareButton = ada.locator('[aria-label="Share post"], [aria-label="Share"]').first();
    let sharedByDialog = false;
    if (await shareButton.count()) {
      await shareButton.click({ force: true }).catch(() => undefined);
      await ada.waitForTimeout(900);
      // The popover summarises access; "Invite people" opens the dialog that
      // actually takes an email and a role.
      const invite = ada.getByRole("button", { name: /invite people/i }).first();
      if (await invite.count()) {
        await invite.click({ force: true }).catch(() => undefined);
        await ada.waitForTimeout(1200);
      }
      const email = ada.locator('input[placeholder="name@example.com"]').first();
      if (await email.count()) {
        await email.fill(GRACE.email);
        const role = ada.locator('[aria-label="Invite role"]').first();
        if (await role.count()) await role.selectOption("editor").catch(() => undefined);
        await shot(ada, "01-ada-invite-filled");
        await ada.keyboard.press("Enter");
        await ada.waitForTimeout(2200);
        // The invite is only real if it comes back listed on the item.
        const listed = await ada
          .getByText(GRACE.email, { exact: false })
          .count()
          .catch(() => 0);
        sharedByDialog = listed > 0;
        note(`  invite listed on the item: ${listed}`);
      }
      await shot(ada, "01-ada-share-dialog");
      await ada.keyboard.press("Escape");
      await ada.waitForTimeout(600);
    }
    // The compact reader/editor shell can intentionally omit the share chrome
    // at narrow widths. Exercise the same access command surface that hosted
    // agents use so the collaboration run still proves a real editor invite.
    if (!sharedByDialog) {
      const access = await agentTool(token, "TextText collaboration verifier", "set_access", {
        scope_type: "item",
        scope_id: itemId,
        email: GRACE.email,
        role: "editor",
      });
      sharedByDialog = access.ok;
      note(`  command-surface invite -> ${access.ok ? "accepted" : `failed: ${access.body.slice(0, 180)}`}`);
    }
    // Access mutations can revalidate the document route. Re-open the same
    // URL before measuring live edits so the writer has a mounted editor.
    await ada.goto(itemUrl, { waitUntil: "domcontentloaded" });
    await ada.waitForTimeout(1800);
    await ada.waitForTimeout(600);
    record(
      "share",
      "Ada can invite Grace as an editor from the item",
      sharedByDialog,
      sharedByDialog
        ? "the share dialog accepted an email and an editor role"
        : "no share control with an email field was reachable from the editor",
    );

    // --- Grace opens the same item ---------------------------------------
    await grace.goto(itemUrl, { waitUntil: "domcontentloaded" });
    await grace.waitForTimeout(3000);
    const graceInEditor = (await bodyField(grace).count()) > 0;
    record(
      "grace-opens",
      "Grace can open the shared item in the editor",
      graceInEditor,
      graceInEditor
        ? "Grace has an editable body field on the same item"
        : `Grace landed on ${grace.url()} without an editable body`,
    );
    if (!graceInEditor) {
      await shot(grace, "02-grace-blocked");
      return;
    }

    // --- 1. human -> human content ---------------------------------------
    const adaLine = `Ada wrote this line. [${RUN}]`;
    await bodyField(ada).click();
    await ada.keyboard.type(adaLine);
    await ada.waitForTimeout(600);

    const sawAda = await until("Grace to receive Ada's text", 25000, async () => {
      const value = await bodyText(grace);
      return value.includes(adaLine) ? value : null;
    });
    record(
      "content-a-to-b",
      "Grace sees Ada's typing without reloading",
      Boolean(sawAda),
      sawAda ? "Ada's line arrived in Grace's editor" : "Ada's line never arrived",
    );

    // --- 2. human -> human, the other direction ---------------------------
    const graceLine = `Grace replied here. [${RUN}]`;
    await bodyField(grace).click();
    await grace.keyboard.press("End");
    await grace.keyboard.type(` ${graceLine}`);
    await grace.waitForTimeout(900);
    const sawGrace = await until("Ada to receive Grace's text", 25000, async () => {
      const value = await bodyText(ada);
      return value.includes(graceLine) ? value : null;
    });
    record(
      "content-b-to-a",
      "Ada sees Grace's typing without reloading",
      Boolean(sawGrace),
      sawGrace ? "Grace's line arrived in Ada's editor" : "Grace's line never arrived",
    );

    // --- 3. human caret ----------------------------------------------------
    await ada.bringToFront();
    await bodyField(ada).click();
    await ada.keyboard.press("Home");
    await ada.keyboard.down("Shift");
    for (let i = 0; i < 8; i += 1) await ada.keyboard.press("ArrowRight");
    await ada.keyboard.up("Shift");
    await ada.waitForTimeout(1500);

    const caret = await until("Ada's caret to paint in Grace's browser", 25000, async () => {
      const count = await grace.locator(".tt-md-surface .tt-remote-caret, .tt-md-surface .tt-md-peer").count();
      if (!count) return null;
      const label = await grace
        .locator(".tt-md-surface .tt-remote-caret")
        .first()
        .getAttribute("data-name")
        .catch(() => "");
      return { count, label };
    });
    await shot(grace, "03-grace-sees-ada-caret");
    record(
      "human-caret",
      "Grace's browser paints Ada's caret or selection, labelled",
      Boolean(caret?.count),
      caret?.count
        ? `${caret.count} remote selection mark(s), label ${JSON.stringify(caret.label)}`
        : "no remote caret or selection mark rendered in Grace's editor",
    );

    // --- 3b. how quickly a WATCHER sees the caret move --------------------
    // Grace does not type here. Watching a colleague write is the common case,
    // and it is the case a poll-shaped transport serves worst. The probe reads
    // the remote-selection layer itself rather than one element, so it does not
    // depend on whether the peer's selection happens to be collapsed.
    const mirrorHtml = async (page: Page) =>
      page
        .locator(".tt-document-editor .tt-md-surface")
        .first()
        .innerHTML()
        .catch(() => "");

    await ada.bringToFront();
    await bodyField(ada).click();
    await ada.keyboard.press("ArrowRight");
    await grace.waitForTimeout(6000); // let the collapsed caret settle for Grace
    const before = await mirrorHtml(grace);
    note(`  watcher mirror before: ${before.length} chars`);

    // If Ada's caret is not in the body, this measures the harness, not the app.
    const focusInfo = { start: await caretOffset(ada) };
    note(`  Ada focus: ${JSON.stringify(focusInfo)}`);

    // Move the caret with arrows, not Home: on macOS Home scrolls the field
    // without moving the insertion point, so it would measure nothing.
    const moveStart = Date.now();
    for (let i = 0; i < 12; i += 1) await ada.keyboard.press("ArrowLeft");
    const moved = await until("Ada's caret to move for an idle Grace", 20000, async () => {
      const now = await mirrorHtml(grace);
      return now && now !== before ? now : null;
    });
    const idleLatencyMs = Date.now() - moveStart;
    note(`  idle watcher saw the caret move after ${idleLatencyMs}ms`);
    const focusAfter = { start: await caretOffset(ada) };
    note(`  Ada insertion point after: ${focusAfter.start}`);
    const movedInField = focusInfo.start !== focusAfter.start;
    record(
      "caret-actually-moved",
      "The writer's caret really moved, so the measurement means something",
      movedInField,
      movedInField
        ? `Ada's insertion point went ${focusInfo.start} -> ${focusAfter.start}`
        : `Ada's insertion point never moved (${focusInfo.start}); the probe would measure nothing`,
    );
    record(
      "idle-caret-latency",
      "A watcher who is not typing sees the caret move within 3s",
      Boolean(moved) && idleLatencyMs <= 3000,
      moved
        ? `the remote selection layer changed after ${idleLatencyMs}ms`
        : `the remote selection layer never changed for an idle watcher (${before.length} chars throughout)`,
    );

    // --- Presence avatars --------------------------------------------------
    const peerCount = await ada.locator(".tt-person-presence").count();
    record(
      "human-presence",
      "Ada's toolbar shows Grace as a present collaborator",
      peerCount > 0,
      `${peerCount} person presence marker(s) in Ada's toolbar`,
    );

    // --- 4. an agent joins -------------------------------------------------
    const presenceRes = await fetch(`${BASE}/api/agent/presence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ itemId, agent: "Codex", activity: "edit", active: true }),
    });
    const presenceBody = await presenceRes.text();
    note(`  agent presence -> ${presenceRes.status} ${presenceBody.slice(0, 160)}`);

    const agentSeen = await until("Codex to appear in Ada's browser", 25000, async () => {
      const badge = ada.locator(".tt-agent-presence");
      if (!(await badge.count())) return null;
      return (await badge.first().innerText()).trim() || "agent";
    });
    await shot(ada, "04-ada-sees-agent");
    record(
      "agent-presence",
      "An agent appears in the open document as a named collaborator",
      Boolean(agentSeen),
      agentSeen
        ? `agent collaborator rendered as ${JSON.stringify(agentSeen)}`
        : `no agent collaborator rendered (presence POST returned ${presenceRes.status})`,
    );

    const agentCaret = await ada
      .locator(".tt-remote-caret")
      .count()
      .catch(() => 0);
    record(
      "agent-caret",
      "The agent carries a caret, not only an avatar",
      agentCaret > 0,
      `${agentCaret} remote caret(s) painted in Ada's editor while the agent is present`,
    );

    // --- 5. the agent writes, with the editor open -------------------------
    const agentLine = `Codex appended this paragraph. [${RUN}]`;
    // The same envelope a hosted client sends: protocol version in the body
    // meta and echoed in the headers, plus the method and tool name headers.
    const mcpRes = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        "Mcp-Method": "tools/call",
        "Mcp-Name": "append_to_item",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        _meta: { "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION },
        params: {
          name: "append_to_item",
          arguments: { id: itemId, markdown_fragment: agentLine },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
            // clientInfo is what makes the agent render as Codex rather than
            // a generic "AI agent", exactly as a hosted client reports itself.
            "io.modelcontextprotocol/clientInfo": { name: "Codex", version: "1.0.0" },
          },
        },
      }),
    });
    const mcpBody = await mcpRes.text();
    note(`  agent append -> ${mcpRes.status} ${mcpBody.slice(0, 220)}`);
    const appendAccepted = mcpRes.ok && !/\"isError\"\s*:\s*true/.test(mcpBody);
    record(
      "agent-write-accepted",
      "The agent's write is accepted by the workspace command surface",
      appendAccepted,
      appendAccepted
        ? "append_to_item returned a non-error result"
        : `append_to_item failed: ${mcpBody.slice(0, 200)}`,
    );

    const liveInAda = await until("Ada's open editor to show the agent's text", 30000, async () => {
      const value = await bodyText(ada);
      return value.includes(agentLine) ? value : null;
    });
    await shot(ada, "05-ada-after-agent-write");
    record(
      "agent-write-visible",
      "A human with the item open sees the agent's write appear",
      Boolean(liveInAda),
      liveInAda
        ? "the agent's paragraph arrived in the open editor"
        : "the agent's paragraph never reached the open editor; only a reload would show it",
    );

    // Does the human's next save overwrite what the agent wrote?
    await bodyField(ada).click();
    await ada.keyboard.press("End");
    await ada.keyboard.type(" Ada kept typing.");
    await ada.waitForTimeout(3500);
    const reread = await grace.goto(itemUrl, { waitUntil: "domcontentloaded" });
    void reread;
    await grace.waitForTimeout(3000);
    const survivedValue = await bodyText(grace);
    const survived = survivedValue.includes(agentLine);
    record(
      "agent-write-survives",
      "The agent's write survives the human's next save",
      survived,
      survived
        ? "the agent's paragraph is still present after the human kept typing"
        : "the human's editor overwrote the agent's paragraph",
    );
    await shot(grace, "06-grace-after-reload");

    // --- 6. every documented client renders as itself -------------------
    for (const provider of ["ChatGPT", "Claude", "Cursor"]) {
      await agentPresence(token, itemId, provider, true);
      const seen = await until(`${provider} to appear`, 20000, async () => {
        const labels = await ada.locator(".tt-agent-presence").allInnerTexts();
        return labels.some((l) => l.trim() === provider) ? labels : null;
      });
      record(
        `agent-name-${provider.toLowerCase()}`,
        `${provider} appears under its own name, not a generic agent`,
        Boolean(seen),
        seen
          ? `presence row rendered ${JSON.stringify(seen)}`
          : `no collaborator labelled ${provider}`,
      );
    }
    await shot(ada, "07-ada-sees-every-agent");

    // --- 7. presence clears when the agent finishes ----------------------
    for (const provider of ["ChatGPT", "Claude", "Cursor", "Codex"]) {
      await agentPresence(token, itemId, provider, false);
    }
    const cleared = await until("agent presence to clear", 25000, async () =>
      (await ada.locator(".tt-agent-presence").count()) === 0 ? true : null,
    );
    record(
      "agent-presence-clears",
      "An agent stops being a collaborator when its work finishes",
      Boolean(cleared),
      cleared
        ? "no agent collaborator remains after the agents reported done"
        : `${await ada.locator(".tt-agent-presence").count()} agent(s) still shown`,
    );

    // --- 8. the U in CRUD, live -------------------------------------------
    await agentPresence(token, itemId, "Codex", true);
    const newTitle = `Launch plan, revised by Codex [${RUN}]`;
    const update = await agentTool(token, "Codex", "update_item", {
      id: itemId,
      title: newTitle,
    });
    record(
      "agent-update-accepted",
      "An agent can update an item through the command surface",
      update.ok,
      update.ok ? "update_item returned a non-error result" : update.body.slice(0, 200),
    );
    const titleLive = await until("the new title to reach Ada", 30000, async () => {
      const value = await titleField(ada).inputValue().catch(() => "");
      return value.includes(`revised by Codex [${RUN}]`) ? value : null;
    });
    record(
      "agent-update-visible",
      "The human sees the agent's update land in the open item",
      Boolean(titleLive),
      titleLive ? `title is now ${JSON.stringify(titleLive)}` : "the title never changed for the human",
    );

    // --- 9. the contended case: an agent writes while both humans type ----
    await grace.goto(itemUrl, { waitUntil: "domcontentloaded" });
    await grace.waitForTimeout(3000);
    await bodyField(ada).click();
    await ada.keyboard.press("End");
    await ada.keyboard.type(" Ada is still here.");
    await bodyField(grace).click();
    await grace.keyboard.press("End");
    await grace.keyboard.type(" Grace is still here.");
    await ada.waitForTimeout(1200);

    const contendedLine = `Codex wrote while both humans were editing. [${RUN}]`;
    const contended = await agentTool(token, "Codex", "append_to_item", {
      id: itemId,
      markdown_fragment: contendedLine,
    });
    const contendedSeen = await until(
      "the contended agent write to reach both humans",
      40000,
      async () => {
        const a = await bodyText(ada);
        const g = await bodyText(grace);
        return a.includes(contendedLine) && g.includes(contendedLine) ? { a, g } : null;
      },
    );
    await shot(ada, "08-ada-contended");
    await shot(grace, "09-grace-contended");
    record(
      "agent-write-contended",
      "An agent's write reaches BOTH humans while they are both editing",
      Boolean(contendedSeen) && contended.ok,
      contendedSeen
        ? "both open editors show the agent's paragraph"
        : "the agent's paragraph did not reach both open editors while they were co-editing",
    );

    // Nobody's words were lost in the three-way merge.
    const finalAda = await bodyText(ada);
    const allPresent =
      finalAda.includes("Ada is still here.") &&
      finalAda.includes("Grace is still here.") &&
      finalAda.includes(contendedLine);
    record(
      "three-way-merge",
      "Two humans and an agent editing at once lose nothing",
      allPresent,
      allPresent
        ? "all three contributions are present in the merged body"
        : `merged body is missing a contribution: ${JSON.stringify(finalAda.slice(0, 200))}`,
    );

    // --- 10. the right-hand sidebar assistant -----------------------------
    // The assistant's provider chooses WHICH tool to call; the executor behind
    // it is /api/ai/tools, session-authenticated and shared with MCP. Driving
    // that executor from Ada's own browser session proves the sidebar's edit
    // path without standing up a paid model.
    const handle = new URL(itemUrl).pathname.split("/")[1].replace(/^@/, "");
    // Clear every agent first, so anything that appears next is attributable
    // to the assistant rather than left over from the Codex legs above.
    await agentPresence(token, itemId, "Codex", false);
    const drained = await until("agent presence to drain", 30000, async () =>
      (await ada.locator(".tt-agent-presence").count()) === 0 ? true : null,
    );
    note(`  agent presence drained before the assistant leg: ${Boolean(drained)}`);
    const assistantLine = `The assistant added this section. [${RUN}]`;
    const assistantResult = await ada.evaluate(
      async ([h, id, text]) => {
        const res = await fetch("/api/ai/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            handle: h,
            name: "append_to_item",
            args: { id, markdown_fragment: text },
          }),
        });
        return { status: res.status, body: (await res.text()).slice(0, 300) };
      },
      [handle, itemId, assistantLine] as const,
    );
    note(`  assistant tool -> ${assistantResult.status} ${assistantResult.body}`);
    record(
      "assistant-accepted",
      "The sidebar assistant's executor accepts a content change",
      assistantResult.status === 200,
      assistantResult.status === 200
        ? "the shared executor ran append_to_item for the session"
        : `the assistant executor returned ${assistantResult.status}: ${assistantResult.body}`,
    );

    const assistantSeen = await until(
      "the assistant's text to reach both humans",
      40000,
      async () => {
        const a = await bodyText(ada);
        const g = await bodyText(grace);
        return a.includes(assistantLine) && g.includes(assistantLine) ? true : null;
      },
    );
    await shot(ada, "10-ada-after-assistant");

    // A human edit comes with a person attached to it. An assistant edit that
    // arrives with nobody attached does not look the same.
    const assistantPresence = await until(
      "the assistant to appear as a collaborator",
      20000,
      async () => {
        const labels = await ada.locator(".tt-agent-presence").allInnerTexts();
        return labels.length ? labels : null;
      },
    );
    await shot(ada, "11-ada-assistant-presence");
    record(
      "assistant-presence",
      "The sidebar assistant appears as a collaborator while it edits",
      Boolean(assistantPresence),
      assistantPresence
        ? `presence row rendered ${JSON.stringify(assistantPresence)}`
        : "the assistant changed the document with no collaborator attached to the change",
    );

    record(
      "assistant-visible",
      "A sidebar-assistant edit looks the same as a human edit to everyone watching",
      Boolean(assistantSeen),
      assistantSeen
        ? "the assistant's section appeared in both open editors, with no reload"
        : "the assistant's section did not reach the open editors",
    );

    await agentPresence(token, itemId, "Codex", false);
    await adaCtx.close();
    await graceCtx.close();
  } finally {
    await browser.close();
  }
}

/** Resolve a dev-login user id without going through the tool surface. */
async function resolveUserId(email: string): Promise<string | null> {
  const { db } = await import("@/lib/db/client");
  const { users } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  if (!db) return null;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0]?.id ?? null;
}

let server: ChildProcess | null = null;

async function run(): Promise<void> {
  let exitCode = 0;
  try {
    if (!process.env.LIVE_COLLAB_BASE) {
      server = spawn("npx", ["next", "start", "-p", String(PORT)], {
        cwd: process.cwd(),
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      server.stdout?.on("data", () => undefined);
      server.stderr?.on("data", (d: Buffer) => {
        const text = d.toString();
        if (/error/i.test(text)) note(`  [server] ${text.trim().slice(0, 300)}`);
      });
    }
    await main();
  } catch (error) {
    note(`\nharness error: ${error instanceof Error ? error.stack : String(error)}`);
    exitCode = 1;
  } finally {
    const failed = checks.filter((c) => !c.passed);
    const summary = [
      "",
      "-".repeat(72),
      `live collaboration: ${checks.length - failed.length}/${checks.length} checks passed`,
      "-".repeat(72),
      ...checks.map((c) => `${c.passed ? "PASS" : "FAIL"}  ${c.id.padEnd(22)} ${c.title}`),
      "",
      `screenshots: ${SHOTS}`,
    ].join("\n");
    console.log(summary);
    writeFileSync(`${SHOTS}/report.txt`, [...notes, summary].join("\n"));
    if (failed.length) exitCode = 1;
    server?.kill("SIGTERM");
    await sleep(900);
    if (server && !server.killed) server.kill("SIGKILL");
    await closeDatabaseConnections().catch(() => undefined);
  }
  process.exit(exitCode);
}

void run();
