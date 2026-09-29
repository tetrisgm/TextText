/** One local human editor remains open while the installed Mac agent appends.
 * Waits for a newline on stdin before the human edit, so the native turn can
 * start first. Uses only the existing local test account and test note.
 */
import { chromium } from "playwright";
import { getPostById } from "../src/lib/store";
import { materializeCollabDocument } from "../src/lib/collab";

const origin = "http://localhost:3000";
const handle = "visual-demo";
const itemID = "3057e689-6421-4225-826a-d72d06732982";
const itemPath = `/t/${handle}/blog/typing-benchmark-7d924acf?edit=1&id=${itemID}`;
const editorSelector = ".tt-document-editor .tt-md-surface";

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Requires local Postgres");
  const existing = await getPostById(handle, itemID);
  if (!existing || existing.title !== "Typing benchmark 7d924acf" || existing.visibility !== "private") {
    throw new Error("Expected private local test note is missing");
  }
  const stamp = crypto.randomUUID().slice(0, 8);
  const humanLine = `Human concurrent ${stamp}.`;
  const agentLine = `Agent concurrent ${stamp}.`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(`${origin}/editor`, { waitUntil: "domcontentloaded" });
      const form = page.locator("form.ac-devsignin");
      await form.waitFor();
      await page.waitForFunction(() => {
        const node = document.querySelector("form.ac-devsignin");
        return node && Object.keys(node).some((key) => key.startsWith("__reactProps$"));
      });
      await form.locator("input[type=email]").fill("second-editor@texttext.local");
      await form.locator("button[type=submit]").click();
      await page.waitForURL((url) => !url.pathname.startsWith("/editor"));
      const response = await page.goto(`${origin}${itemPath}`, { waitUntil: "domcontentloaded" });
      if (response?.status() !== 200) throw new Error(`Second editor returned ${response?.status()}`);
      const editor = page.locator(editorSelector).first();
      await editor.waitFor();
      await page.waitForFunction((selector) => {
        const node = document.querySelector(selector);
        return node && Object.keys(node).some((key) => key.startsWith("__reactProps$"));
      }, editorSelector);
      await page.waitForFunction((selector) =>
        document.querySelector(selector)?.textContent?.includes("Installed browser sign-in verification 2026-09-28."),
      editorSelector);
      console.log(`READY human=${humanLine} agent=${agentLine}`);
      await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
      await editor.click();
      await page.keyboard.press("Meta+End");
      await page.keyboard.type(`\n${humanLine}`);
      await page.waitForFunction(({ selector, text }) =>
        document.querySelector(selector)?.textContent?.includes(text),
      { selector: editorSelector, text: humanLine });
      console.log("HUMAN_EDIT_VISIBLE");
      await page.locator(".tt-save-state.is-saved").waitFor({ timeout: 60_000 });
      console.log("HUMAN_EDIT_SAVED");
      try {
        await page.waitForFunction(({ selector, text }) =>
          document.querySelector(selector)?.textContent?.includes(text),
        { selector: editorSelector, text: agentLine }, { timeout: 60_000 });
      } catch (error) {
        const visible = (await editor.textContent().catch(() => null))?.slice(-300);
        console.error(`SECOND_EDITOR_DIAGNOSTIC url=${page.url()} visible=${JSON.stringify(visible)}`);
        throw error;
      }
      let stored = await getPostById(handle, itemID);
      const deadline = Date.now() + 30_000;
      while (stored && Date.now() < deadline &&
          (!JSON.stringify(stored).includes(humanLine) || !JSON.stringify(stored).includes(agentLine))) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        stored = await getPostById(handle, itemID);
      }
      const serialized = JSON.stringify(stored);
      if (!stored || stored.title !== existing.title ||
          !serialized.includes("Typing7d924acf:abcdefghijklmnopqrstuvwxyz0123") ||
          !serialized.includes(humanLine) || !serialized.includes(agentLine)) {
        const live = await materializeCollabDocument(itemID);
        const saveLabel = await page.locator(".tt-save-state").first().textContent().catch(() => null);
        console.error(`CANONICAL_DIAGNOSTIC save=${JSON.stringify(saveLabel)} liveHuman=${live?.content.body.includes(humanLine)} canonicalHuman=${serialized.includes(humanLine)} liveAgent=${live?.content.body.includes(agentLine)} canonicalAgent=${serialized.includes(agentLine)}`);
        throw new Error("Saved note did not contain both complete edits and the original marker");
      }
      console.log("PASS: second editor received agent line; store retained the human line, agent line, original marker, and title");
    } finally { await context.close(); }
  } finally { await browser.close(); }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Collaboration check failed");
  process.exit(1);
});
