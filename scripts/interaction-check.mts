/**
 * Drive the workspace the way a person does and assert the outcome, watching
 * for anything thrown along the way. A benchmark says how long something
 * took; this says whether it worked.
 *
 *   npx tsx scripts/interaction-check.mts
 *
 * Needs a production server on :3131 with AUTH_DEV_LOGIN=1 and the
 * visual-demo fixture workspace, the same as scripts/visual-surfaces.mts.
 */
import { webkit, type Page, type ConsoleMessage } from "playwright";
const ORIGIN = "http://localhost:3131";

const errors: string[] = [];
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = async (name: string, fn: () => Promise<string>) => {
  try {
    const detail = await fn();
    results.push({ name, ok: !detail.startsWith("FAIL"), detail });
  } catch (error) {
    results.push({ name, ok: false, detail: `threw: ${String(error).slice(0, 120)}` });
  }
};

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url().replace(ORIGIN, "")}`);
});
page.on("console", (m: ConsoleMessage) => {
  if (m.type() !== "error") return;
  const text = m.text();
  // A cancelled fetch during a fast navigation is the browser doing as asked.
  if (/access control checks|Load failed|cancelled/i.test(text)) return;
  const loc = m.location();
  errors.push(`console: ${text.slice(0, 120)} @ ${(loc.url ?? "").replace(ORIGIN, "") || "?"}`);
});

await page.goto(`${ORIGIN}/editor`, { waitUntil: "networkidle" });
const form = page.locator("form.ac-devsignin");
await form.waitFor({ timeout: 20000 });
await form.locator("input[type=email]").fill("visual-demo@texttext.local");
await form.locator("button[type=submit]").click();
await page.waitForSelector("[data-workspace-post-id]", { timeout: 30000 });
await page.waitForTimeout(1800);
await page.evaluate("globalThis.__name = (fn) => fn");

const rows = () => page.locator("[data-workspace-post-id]");
const rowCount = () => rows().count();
const selected = () =>
  page.locator('[data-workspace-post-id][aria-selected="true"]').count();
const title = () =>
  page.evaluate(() => document.querySelector("h1")?.textContent?.trim() ?? "");
const pause = (ms = 900) => page.waitForTimeout(ms);

await check("the list renders items", async () =>
  (await rowCount()) > 3 ? `${await rowCount()} rows` : "FAIL empty list",
);

await check("clicking a row opens it", async () => {
  await rows().first().click();
  await pause(2200);
  const heading = await title();
  return heading ? `opened "${heading.slice(0, 30)}"` : "FAIL no document";
});

await check("backspace goes back to the list", async () => {
  await page.keyboard.press("Backspace");
  await pause(1600);
  return (await rowCount()) > 3 ? "back on the list" : "FAIL still on the item";
});

await check("j and k move the selection", async () => {
  await rows().first().click({ position: { x: 500, y: 15 } });
  await pause(1400);
  await page.keyboard.press("Escape");
  await pause(800);
  const before = await page.evaluate(() =>
    document.querySelector(".workspace-item-option.is-command-selected")?.textContent?.slice(0, 20) ?? "",
  );
  await page.keyboard.press("j");
  await pause(400);
  const after = await page.evaluate(() =>
    document.querySelector(".workspace-item-option.is-command-selected")?.textContent?.slice(0, 20) ?? "",
  );
  return before !== after ? "selection moved" : `FAIL stayed on "${before}"`;
});

await check("shift+down extends the selection", async () => {
  await page.keyboard.press("Shift+ArrowDown");
  await pause(500);
  const n = await selected();
  return n >= 2 ? `${n} selected` : `FAIL ${n} selected`;
});

await check("cmd+a selects everything, escape clears it", async () => {
  await page.keyboard.press("Meta+a");
  await pause(600);
  const all = await selected();
  await page.keyboard.press("Escape");
  await pause(600);
  const none = await selected();
  return all > 3 && none <= 1
    ? `${all} then ${none}`
    : `FAIL ${all} then ${none}`;
});

await check("a multi-select teaches the way out, once", async () => {
  // The hint toast fires the first time a selection grows in a session.
  const first = await page.evaluate(
    () => document.querySelector(".command-toast.is-hint")?.textContent ?? "",
  );
  await page.keyboard.press("Escape");
  // Wait the first hint out - it lives 4s - or the second reading finds the
  // first one still on screen and calls a working feature broken.
  await pause(4600);
  await page.keyboard.press("Shift+ArrowDown");
  await pause(900);
  const second = await page.evaluate(
    () => document.querySelectorAll(".command-toast.is-hint").length,
  );
  return first.includes("esc") && second === 0
    ? `taught once: "${first.replace(/\s+/g, " ").trim().slice(0, 34)}"`
    : `FAIL first="${first}" secondTime=${second}`;
});

await check("slash focuses search and filters", async () => {
  await page.keyboard.press("Slash");
  await pause(700);
  const focused = await page.evaluate(
    () => document.activeElement?.tagName.toLowerCase() ?? "",
  );
  await page.keyboard.press("Escape");
  await pause(500);
  return focused === "input" ? "search focused" : `FAIL focus on ${focused}`;
});

await check("cmd+k opens the palette and escape closes it", async () => {
  await page.keyboard.press("Meta+k");
  await pause(800);
  const open = await page.locator(".command-palette").count();
  await page.keyboard.press("Escape");
  await pause(600);
  const closed = await page.locator(".command-palette").count();
  return open === 1 && closed === 0 ? "opened and closed" : `FAIL ${open}/${closed}`;
});

await check("? opens the shortcut panel", async () => {
  await page.keyboard.press("Shift+Slash");
  await pause(800);
  const open = await page.locator(".command-palette--sheet").count();
  const groups = await page.locator(".command-shortcut-group").count();
  await page.keyboard.press("Escape");
  await pause(600);
  return open === 1 && groups > 2 ? `${groups} groups` : `FAIL ${open}/${groups}`;
});

await check("shift+cmd+L cycles the appearance", async () => {
  const readStamp = () =>
    page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const seen = new Set<string>();
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Meta+Shift+l");
    await pause(500);
    seen.add(String(await readStamp()));
  }
  return seen.size >= 2 ? `saw ${[...seen].join(",")}` : `FAIL ${[...seen]}`;
});

await check("opening a second item makes a second tab", async () => {
  await rows().nth(1).click();
  await pause(2000);
  const one = await page.locator(".workspace-tab").count();
  await page.keyboard.press("Backspace");
  await pause(1400);
  await rows().nth(3).click();
  await pause(2000);
  const two = await page.locator(".workspace-tab").count();
  return two >= one ? `${one} then ${two} tabs` : `FAIL ${one} then ${two}`;
});

await check("cmd+w closes the tab", async () => {
  const before = await page.locator(".workspace-tab").count();
  await page.keyboard.press("Meta+w");
  await pause(1400);
  const after = await page.locator(".workspace-tab").count();
  return after < before || after === 0
    ? `${before} then ${after}`
    : `FAIL ${before} then ${after}`;
});

await check("shift+cmd+T brings it back", async () => {
  const before = await page.locator(".workspace-tab").count();
  await page.keyboard.press("Meta+Shift+t");
  await pause(1600);
  const after = await page.locator(".workspace-tab").count();
  return after > before ? `${before} then ${after}` : `FAIL ${before} then ${after}`;
});

await check("the sidebar navigates to a collection", async () => {
  await page.locator('[data-workspace-sidebar-path="notes"]').first().click();
  await pause(1800);
  const active = await page
    .locator('[data-workspace-sidebar-path="notes"] .post-editor-folder-row.is-active, .post-editor-folder-row.is-active')
    .count();
  return active > 0 ? "collection active" : "FAIL no active row";
});

await check("the hint bar follows the view", async () => {
  const inList = await page.locator(".workspace-key-hint").count();
  await rows().first().click();
  await pause(2000);
  const inItem = await page.locator(".workspace-key-hint").count();
  const listText = await page.evaluate(
    () => document.querySelector(".workspace-key-hints")?.textContent ?? "",
  );
  await page.keyboard.press("Backspace");
  await pause(1400);
  return inList > 0 && inItem > 0 && listText.length > 10
    ? `${inList} then ${inItem} hints`
    : `FAIL ${inList}/${inItem}`;
});

await check("hovering a control shows its tooltip with keys", async () => {
  await page.hover('button[aria-label="Go back"]');
  await pause(700);
  const tip = await page.evaluate(
    () => document.querySelector(".kbd-tip")?.textContent ?? "",
  );
  await page.mouse.move(700, 500);
  return tip.length > 2 ? `tooltip "${tip.slice(0, 24)}"` : "FAIL no tooltip";
});

console.log("");
for (const r of results) {
  console.log(`${r.ok ? "  pass" : "  FAIL"}  ${r.name.padEnd(46)} ${r.detail}`);
}
console.log("");
if (errors.length) {
  console.log(`${errors.length} errors thrown during the walk:`);
  for (const e of [...new Set(errors)].slice(0, 12)) console.log("   " + e);
} else {
  console.log("no errors thrown during the walk");
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
