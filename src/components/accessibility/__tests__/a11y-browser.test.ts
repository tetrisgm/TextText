import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type Server } from "node:http";

describe.skipIf(process.env.TEXTTEXT_A11Y_BROWSER !== "1")("browser accessibility (requires browser launch and loopback permissions)", () => {
let browser: Browser, server: Server, page: Page, url: string;
const errors: string[] = [];
beforeAll(async () => {
  const { buildFixture } = await import("./build-fixture");
  const { js, css } = await buildFixture();
  server = createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/fixture.js" ? "application/javascript" : "text/html");
    res.end(req.url === "/fixture.js" ? js : `<!doctype html><html lang="en" data-theme="light"><head><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});
beforeEach(async () => {
  if (page) await page.close();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  errors.length = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.goto(url);
  await expect.poll(() => errors).toEqual([]);
  await page.getByRole("button", { name: "Comments", exact: true }).waitFor();
});
afterAll(async () => { await browser?.close(); await new Promise<void>(done => server ? server.close(() => done()) : done()); });

async function activate(name: string) {
  // Reach every opener by Tab, not by programmatic focus or pointer click.
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const match = await page.getByRole("button", { name, exact: true }).evaluateAll(nodes => nodes.some(node => node === document.activeElement));
    if (match) { await page.keyboard.press("Enter"); return; }
  }
  throw new Error(`Keyboard cannot reach ${name}`);
}

for (const [name, role, label] of [
  ["Comments", "dialog", "Comments"], ["Share", "dialog", "Share"],
  ["Folder look", "dialog", "Choose a look"], ["Confirmation", "alertdialog", "Delete item?"],
  ["Command palette", "dialog", "Command palette"], ["Keyboard shortcuts", "dialog", "Keyboard shortcuts"],
] as const) it(`${name}: keyboard entry, modal focus order, containment, Escape and return`, async () => {
  await activate(name);
  const dialog = page.getByRole(role, { name: label, exact: true });
  await dialog.waitFor();
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  const visited = new Set<string>();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    visited.add(await page.evaluate(() => (document.activeElement?.textContent ?? "") + document.activeElement?.getAttribute("aria-label")));
  }
  expect(visited.size).toBeGreaterThanOrEqual(name === "Keyboard shortcuts" ? 1 : 2);
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  expect(await page.getByRole("button", { name, exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
  expect(errors).toEqual([]);
});

it("Enter on Cancel never confirms a destructive action", async () => {
  await activate("Confirmation");
  await page.getByRole("button", { name: "Cancel", exact: true }).waitFor();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.a11yCalls)).not.toContain("delete");
  await page.getByRole("alertdialog").waitFor({ state: "hidden" });
});

it("Add agent: native popover opens and dismisses by keyboard with return", async () => {
  await activate("Add agent");
  const dialog = page.getByRole("dialog", { name: "Add agent", exact: true });
  await dialog.waitFor();
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  expect(await page.getByRole("button", { name: "Add agent", exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
});

it("tabs support arrows, End, reordering, preview promotion and closing without losing focus", async () => {
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  expect(await page.getByRole("tab", { name: "First item" }).evaluate(node => node === document.activeElement)).toBe(true);
  await page.keyboard.press("End");
  expect(await page.getByRole("tab", { selected: true }).textContent()).toContain("Second item");
  await page.keyboard.press("F2");
  expect(await page.evaluate(() => window.a11yCalls)).toContain("promote");
  await page.keyboard.press("Alt+ArrowLeft");
  expect((await page.getByRole("tab").allTextContents())[0]).toContain("Second item");
  await page.keyboard.press("Delete");
  expect(await page.getByRole("tab", { name: "First item" }).evaluate(node => node === document.activeElement)).toBe(true);
  await page.keyboard.press("Delete");
  expect(await page.getByRole("main").evaluate(node => node === document.activeElement)).toBe(true);
});

it("context removal recovers focus and search announces the active option", async () => {
  await activate("Remove context First item");
  expect(await page.getByRole("textbox", { name: "Edit item" }).evaluate(node => node === document.activeElement)).toBe(true);
  await activate("Add TextText context");
  const search = page.getByRole("combobox", { name: "Search TextText items by title or folder" });
  await search.waitFor();
  await page.keyboard.press("ArrowDown");
  const selected = await search.getAttribute("aria-activedescendant");
  expect(await page.locator(`[id="${selected}"]`).getAttribute("aria-selected")).toBe("true");
  await page.keyboard.press("Enter");
  expect(await page.getByRole("textbox", { name: "Edit item" }).evaluate(node => node === document.activeElement)).toBe(true);
  expect(await page.getByRole("button", { name: "Remove context Second item" }).count()).toBe(1);
});

it("comment completion is announced once and resolving recovers removed focus", async () => {
  await activate("Comments");
  const dialog = page.getByRole("dialog", { name: "Comments", exact: true });
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  expect(await page.getByRole("textbox", { name: "Add a comment" }).evaluate(node => node === document.activeElement)).toBe(true);
  await page.keyboard.type("Keyboard comment");
  expect(await dialog.getByRole("status").textContent()).toBe("");
  await page.keyboard.press("Control+Enter");
  await expect.poll(() => dialog.getByRole("status").textContent()).toBe("Comment posted.");
  await activate("Resolve");
  await expect.poll(() => dialog.getByRole("status").textContent()).toBe("Comment resolved.");
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
});

it("palette exposes a named combobox linked to selected results", async () => {
  await activate("Command palette");
  const input = page.getByRole("combobox", { name: "Search items and commands" });
  await input.waitFor();
  await page.keyboard.press("ArrowDown");
  const id = await input.getAttribute("aria-activedescendant");
  expect(await page.locator(`[id="${id}"]`).getAttribute("aria-selected")).toBe("true");
  expect(await page.getByRole("listbox", { name: "Items and commands" }).getAttribute("id")).toBe(await input.getAttribute("aria-controls"));
});

it("sign in has one main, a heading and keyboard provider controls", async () => {
  await page.goto(`${url}/?signin`);
  await page.getByRole("heading", { level: 1, name: "Sign in to TextText" }).waitFor();
  expect(await page.getByRole("main").count()).toBe(1);
  await activate("Sign in with Apple");
  await activate("Sign in with Google");
  expect(await page.evaluate(() => window.a11yCalls)).toEqual(["signin:apple", "signin:google"]);
});

it("AI actions work by keyboard and translation has a sentence name", async () => {
  await activate("Summarize");
  expect(await page.evaluate(() => window.a11yCalls)).toContain("summarize");
  await page.keyboard.press("Tab");
  const select = page.getByRole("combobox", { name: "Translate to a language" });
  expect(await select.evaluate(node => node === document.activeElement)).toBe(true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  expect((await page.evaluate(() => window.a11yCalls)).some(call => call.startsWith("translate:"))).toBe(true);
});

it("fast saving updates settle into one atomic live announcement", async () => {
  await page.getByRole("textbox", { name: "Edit item" }).focus();
  await page.keyboard.type("Many keystrokes");
  expect(await page.getByRole("main").getByRole("status").textContent()).toBe("");
  await activate("Finish save");
  await expect.poll(() => page.getByRole("main").getByRole("status").textContent()).toBe("Saved");
});

it("idle stays silent and successive fast saves mutate the same live region", async () => {
  await page.waitForTimeout(750);
  const status = page.getByRole("main").getByRole("status");
  expect(await status.textContent()).toBe("");
  await status.evaluate(node => {
    node.setAttribute("data-mutations", "0");
    new MutationObserver(() => node.setAttribute("data-mutations", String(Number(node.getAttribute("data-mutations")) + 1)))
      .observe(node, { childList: true, subtree: true, characterData: true });
  });
  for (let cycle = 0; cycle < 2; cycle++) {
    const before = Number(await status.getAttribute("data-mutations"));
    await page.getByRole("textbox", { name: "Edit item" }).fill(`Edit ${cycle}`);
    await page.getByRole("button", { name: "Finish save" }).click();
    await expect.poll(async () => Number(await status.getAttribute("data-mutations"))).toBeGreaterThan(before);
    expect(await status.textContent()).toBe("Saved");
  }
});

for (const theme of ["light", "dark"]) describe(`${theme} accessibility rendering`, () => {
  beforeEach(async () => { await page.locator("html").evaluate((node, value) => node.setAttribute("data-theme", value), theme); });
  it("computed focus outline is solid and contrast preferences define control borders", async () => {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe("solid");
    await page.emulateMedia({ contrast: "more" });
    expect(await page.getByRole("button", { name: "Comments", exact: true }).evaluate(node => getComputedStyle(node).borderTopWidth)).toBe("1px");
    await page.emulateMedia({ forcedColors: "active" });
    expect(await page.getByRole("button", { name: "Comments", exact: true }).evaluate(node => getComputedStyle(node).borderTopStyle)).toBe("solid");
  });
  for (const name of ["Comments", "Share", "Folder look", "Command palette", "Add agent"]) it(`${name} remains reachable and fits at 200% text`, async () => {
    await page.locator("html").evaluate(node => { node.style.fontSize = "200%"; });
    await activate(name);
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const measurements = await dialog.evaluate(node => {
      const box = node.getBoundingClientRect();
      const controls = Array.from(node.querySelectorAll<HTMLElement>('button, input, textarea, select'))
        .filter(n => n.getClientRects().length && !n.matches(':disabled'));
      return { left: box.left, right: box.right, viewport: innerWidth,
        overflow: node.scrollWidth - node.clientWidth,
        text: controls.map(n => ({ font: parseFloat(getComputedStyle(n).fontSize), height: n.clientHeight })) };
    });
    expect(measurements.left).toBeGreaterThanOrEqual(0);
    expect(measurements.right).toBeLessThanOrEqual(measurements.viewport + 1);
    expect(measurements.overflow).toBeLessThanOrEqual(2);
    for (const control of measurements.text) expect(control.height).toBeGreaterThanOrEqual(control.font);
    expect(errors).toEqual([]);
  });
});

});
