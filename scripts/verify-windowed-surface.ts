/**
 * Windowed-surface integrity check: edits made while jumping around a large
 * document must survive the full publish -> Yjs -> materialize -> reload trip
 * with the exact source intact. Server on :3131 with dev sign-in.
 */
import { chromium } from "playwright";

const ORIGIN = "http://localhost:3131";
const OWNER_EMAIL = "visual-demo@texttext.local";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
  if (!ok) failures += 1;
}

async function run(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.evaluate("globalThis.__name = (fn) => fn").catch(() => {});
  await page.goto(`${ORIGIN}/editor`, { waitUntil: "networkidle" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 20000 });
  await form.locator("input[type=email]").fill(OWNER_EMAIL);
  await form.locator("button[type=submit]").click();
  await page.waitForTimeout(1500);

  // The numbered fixture is seeded in the dev database beforehand (see
  // docs/HANDOFF.md); pass its id as argv[2] if it was recreated.
  const lineCount = 6000;
  const postId = process.argv[2] ?? "926e5a49-c0b6-4198-bc54-b5005575ad03";
  const slug = "windowed-integrity";

  await page.goto(`${ORIGIN}/@visual-demo/${slug}?edit=1&id=${postId}`);
  const surface = page.locator(".tt-document-editor .tt-md-surface").first();
  await surface.waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);

  const windowed = await page.evaluate(() => {
    const root = document.querySelector(".tt-document-editor .tt-md-surface");
    return {
      spacers: root?.querySelectorAll("[data-tt-spacer]").length ?? 0,
      rows: root?.querySelectorAll("[data-tt-ln]").length ?? 0,
    };
  });
  check(
    "windowed mode active (spacers present, partial rows)",
    windowed.spacers === 2 && windowed.rows > 0 && windowed.rows < lineCount,
    JSON.stringify(windowed),
  );

  // Edit at the very top.
  await surface.click({ position: { x: 60, y: 10 } });
  await page.keyboard.press("Meta+ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.type("TOP-EDIT ");
  await page.waitForTimeout(300);

  // Jump to the very end and edit there.
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type(" BOTTOM-EDIT");
  await page.waitForTimeout(300);

  // Scroll to the middle, click a visible row, and split/join lines there.
  const scrolled = await page.evaluate(() => {
    const root = document.querySelector(
      ".tt-document-editor .tt-md-surface",
    ) as HTMLElement;
    let el: HTMLElement | null = root;
    while (el && el.scrollHeight <= el.clientHeight + 4) el = el.parentElement;
    if (!el) return null;
    el.scrollTop = el.scrollHeight / 2;
    return el.scrollTop;
  });
  check("scrolled to middle", scrolled !== null && scrolled > 0);
  await page.waitForTimeout(500);
  const midRowInfo = await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>(".tt-md-surface [data-tt-ln]")];
    const mid = rows.find((row) => {
      const r = row.getBoundingClientRect();
      return r.top > 100 && r.top < window.innerHeight - 100 && r.height > 4;
    });
    if (!mid) return null;
    const rect = mid.getBoundingClientRect();
    return { text: mid.textContent ?? "", x: rect.left + 40, y: rect.top + rect.height / 2 };
  });
  check("found a middle row after rewindow", Boolean(midRowInfo), "no visible row");
  if (midRowInfo) {
    await page.mouse.click(midRowInfo.x, midRowInfo.y);
    await page.keyboard.press("End");
    await page.keyboard.type(" MID-EDIT");
    await page.keyboard.press("Enter");
    await page.keyboard.type("INSERTED-LINE");
    await page.waitForTimeout(300);
  }

  // Let the editor materialize, then reload and verify the source exactly.
  await page.waitForTimeout(2500);
  await page.reload();
  await surface.waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);

  const readBack = await page.evaluate(
    async ({ origin, id }) => {
      const res = await fetch(
        `${origin}/api/post/${encodeURIComponent(id)}/body`,
        { credentials: "include" },
      );
      const json = await res.json().catch(() => null);
      return json?.document?.content?.body ?? null;
    },
    { origin: ORIGIN, id: postId },
  );
  check("body read back after reload", typeof readBack === "string");
  if (typeof readBack === "string") {
    const lines = readBack.split("\n");
    check(
      "top edit landed on line 1",
      lines[0] === "TOP-EDIT line-0001 the quick brown fox",
      JSON.stringify(lines[0]),
    );
    check(
      "bottom edit landed on the last line",
      lines[lines.length - 1] === `line-${lineCount} the quick brown fox BOTTOM-EDIT`,
      JSON.stringify(lines[lines.length - 1]),
    );
    check(
      "middle edit and inserted line landed once",
      readBack.split("MID-EDIT").length === 2 &&
        readBack.split("INSERTED-LINE").length === 2,
      `mid=${readBack.split("MID-EDIT").length - 1} ins=${readBack.split("INSERTED-LINE").length - 1}`,
    );
    check(
      "line count is original + 1",
      lines.length === lineCount + 1,
      String(lines.length),
    );
    // Removing exactly what was typed (wherever the caret actually was; on
    // macOS Home/End scroll rather than move the caret) must restore the
    // original byte-for-byte: nothing else changed anywhere.
    const original = Array.from(
      { length: lineCount },
      (_, i) => `line-${String(i + 1).padStart(4, "0")} the quick brown fox`,
    ).join("\n");
    const restored = readBack
      .replace("TOP-EDIT ", "")
      .replace(" BOTTOM-EDIT", "")
      .replace(" MID-EDIT\nINSERTED-LINE", "");
    check(
      "every untouched byte survived verbatim",
      restored === original,
      `restored ${restored.length} vs original ${original.length}`,
    );
  }

  // Select-all copy must serialize the whole document, not the window.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${ORIGIN}/@visual-demo/${slug}?edit=1&id=${postId}`);
  await surface.waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);
  await surface.click({ position: { x: 60, y: 10 } });
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(
    "select-all copy carries the whole document",
    typeof clip === "string" &&
      clip.includes("TOP-EDIT") &&
      clip.includes("BOTTOM-EDIT") &&
      clip.split("\n").length === lineCount + 1,
    `lines=${clip?.split("\n").length}`,
  );

  await browser.close();
  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
