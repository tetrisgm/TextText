/** Bounded local-input measurement with a second authorized editor present.
 * Run against a local server with local Postgres. Creates one
 * private note in the existing shared Blog fixture and leaves it for review.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getBlog, getPostById, getPostStoreContext } from "../src/lib/store";
import { blogPostEditPath } from "../src/lib/public-paths";

const origin = process.env.BENCH_ORIGIN ?? "http://localhost:3131";
const handle = "visual-demo";
const editorSelector = ".tt-document-editor .tt-md-surface";
const sample = "abcdefghijklmnopqrstuvwxyz0123";

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${origin}/editor`, { waitUntil: "domcontentloaded" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor();
  await page.waitForFunction(() => {
    const node = document.querySelector("form.ac-devsignin");
    return node && Object.keys(node).some((key) => key.startsWith("__reactProps$"));
  });
  await form.locator("input[type=email]").fill(email);
  await form.locator("button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/editor"));
  return page;
}

async function main() {
  const databaseHost = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(databaseHost)) {
    throw new Error("Requires local Postgres");
  }
  const browser = await chromium.launch();
  try {
    const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const secondContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const owner = await signIn(ownerContext, "visual-demo@texttext.local");
      const second = await signIn(secondContext, "second-editor@texttext.local");
      await second.goto(`${origin}/@${handle}?folder=blog`, { waitUntil: "domcontentloaded" });
      const composer = second.locator(".universal-item-composer");
      await composer.waitFor();
      await second.waitForFunction(() => {
        const node = document.querySelector(".universal-item-composer");
        return node && Object.keys(node).some((key) => key.startsWith("__reactProps$"));
      });
      const stamp = crypto.randomUUID().slice(0, 8);
      const title = `Typing benchmark ${stamp}`;
      const capture = second.waitForResponse((response) => response.url().endsWith("/api/workspace/folder-capture"));
      await composer.locator("textarea").fill(`${title}\nTwo people editing this local test note.`);
      await composer.locator("button[type=submit]").click();
      const response = await capture;
      const payload = await response.json() as { item?: { id?: string }; error?: string };
      if (!response.ok() || !payload.item?.id) {
        throw new Error(`Capture failed: ${response.status()} ${payload.error ?? "no item"}`);
      }
      const blog = await getBlog(handle);
      const post = await getPostById(handle, payload.item.id);
      if (!blog || !post || post.visibility !== "private") throw new Error("Private test note was not saved");
      const editPath = blogPostEditPath(blog, post);
      await Promise.all([
        owner.goto(`${origin}${editPath}`, { waitUntil: "domcontentloaded" }),
        second.goto(`${origin}${editPath}`, { waitUntil: "domcontentloaded" }),
      ]);
      const editor = owner.locator(editorSelector).first();
      await editor.waitFor();
      await second.locator(editorSelector).first().waitFor();
      await owner.waitForFunction((selector) => {
        const node = document.querySelector(selector);
        return node && Object.keys(node).some((key) => key.startsWith("__reactProps$"));
      }, editorSelector);
      await editor.click();
      await owner.keyboard.press("Meta+End");
      const marker = `Typing${stamp}:`;
      await owner.keyboard.type(`\n${marker}`);
      await second.waitForFunction(
        ({ selector, text }) => document.querySelector(selector)?.textContent?.includes(text),
        { selector: editorSelector, text: marker }, { timeout: 30_000 },
      );
      await owner.evaluate(({ selector, markerText, characters }) => {
        const state = { samples: [] as number[], next: 0, start: 0 };
        Reflect.set(window, "__ttTypingMark", state);
        document.addEventListener("beforeinput", (event) => {
          const input = event as InputEvent;
          if (input.data === characters[state.next]) state.start = performance.now();
        }, true);
        const observer = new MutationObserver(() => {
          if (!state.start || state.next >= characters.length) return;
          const text = document.querySelector(selector)?.textContent ?? "";
          if (!text.includes(markerText + characters.slice(0, state.next + 1))) return;
          state.samples.push(performance.now() - state.start);
          state.next += 1;
          state.start = 0;
          if (state.next === characters.length) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, characterData: true, subtree: true });
      }, { selector: editorSelector, markerText: marker, characters: sample });
      for (let index = 0; index < sample.length; index += 1) {
        await owner.keyboard.type(sample[index]);
        await owner.waitForFunction((count) => {
          const state = Reflect.get(window, "__ttTypingMark") as { samples: number[] };
          return state.samples.length >= count;
        }, index + 1);
      }
      const finalInputAt = Date.now();
      await second.waitForFunction(
        ({ selector, text }) => document.querySelector(selector)?.textContent?.includes(text),
        { selector: editorSelector, text: marker + sample }, { timeout: 30_000 },
      );
      const peerDelay = Date.now() - finalInputAt;
      let canonicalDelay = -1;
      const saveDeadline = finalInputAt + 30_000;
      while (Date.now() < saveDeadline) {
        const stored = await getPostStoreContext(post.id!);
        if (stored?.post.document?.content.body.includes(marker + sample)) {
          canonicalDelay = Date.now() - finalInputAt;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (canonicalDelay < 0) throw new Error("Final text did not reach the canonical document within 30 seconds");
      const durations = await owner.evaluate(() =>
        (Reflect.get(window, "__ttTypingMark") as { samples: number[] }).samples,
      );
      const sorted = [...durations].sort((a, b) => a - b);
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
      console.log(`PASS: ${title}; local beforeinput-to-DOM n=${sorted.length} median=${sorted[Math.floor(sorted.length / 2)].toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${sorted.at(-1)?.toFixed(1)}ms; peer received final text in ${peerDelay}ms; canonical document in ${canonicalDelay}ms`);
    } finally {
      await ownerContext.close();
      await secondContext.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Typing benchmark failed");
  process.exitCode = 1;
});
