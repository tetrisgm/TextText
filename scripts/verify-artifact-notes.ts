// Local end-to-end proof: New Note, immediate typing, server persistence,
// reload, and reopening from Notes. Owns and removes its scratch notes.
// TEXTTEXT_BASE_URL=http://localhost:3105 npx tsx scripts/verify-artifact-notes.ts
// Add TEXTTEXT_TEST_DELAYED_NOTE=1 to leave and reopen before creation finishes.
import { loadEnvConfig } from "@next/env";
import { chromium, webkit } from "playwright";
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

async function main() {
  const origin = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3100";
  const delayedLeave = process.env.TEXTTEXT_TEST_DELAYED_NOTE === "1";
  const local = (value: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  if (!local(origin) || !process.env.DATABASE_URL || !local(process.env.DATABASE_URL)) throw Error("Local app and Postgres only");
  const store = await import("../src/lib/store");
  const { closeDatabaseConnections } = await import("../src/lib/db/client");
  const handle = "markdown-surface-aug27";
  const before = new Set((await store.getAllPosts(handle)).map((post) => post.id));
  const owned = new Set<string>();
  const marker = `Artifact verification ${Date.now()}`;
  const text = "A note written in the Artifact workspace.\n\n- Keep the notes\n- Keep the speed";
  try {
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch();
      try {
        const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
        const page = await context.newPage();
        const errors: string[] = [];
        let navigatingAt = Date.now();
        let navigationCancellations = 0;
        page.on("pageerror", (error) => {
          // WebKit emits resource errors as page errors when navigation aborts
          // outstanding long-poll/presence fetches. Report them separately;
          // errors during editing still fail the check.
          const cancelledFetch = error.message.includes("due to access control checks.") || /^(?:TypeError: )?Load failed$/.test(error.message);
          if (engine.name() === "webkit" && Date.now() - navigatingAt < 1500 && cancelledFetch) navigationCancellations += 1;
          else errors.push(`${error.message} (${Date.now() - navigatingAt}ms after navigation; ${error.stack ?? "no stack"})`);
        });
        const go = async (url: string) => {
          navigatingAt = Date.now();
          await page.goto(url, { waitUntil: "domcontentloaded" });
          // Match bench-actions: allow hydration before measuring an action.
          await page.waitForTimeout(600);
        };
        await go(`${origin}/api/auth/csrf`);
        const csrfToken = JSON.parse(await page.locator("body").innerText()).csrfToken;
        await page.request.post(`${origin}/api/auth/callback/dev-login`, { form: { csrfToken, email: "markdown-surface-aug27@example.com", name: "Surface", callbackUrl: "/" } });
        await go(`${origin}/t/${handle}?pane=notes`);
        if (delayedLeave) {
          let delayed = false;
          await page.route(`**/t/${handle}**`, async (route) => {
            if (!delayed && route.request().method() === "POST" && route.request().headers()["next-action"]) {
              delayed = true;
              await new Promise((resolve) => setTimeout(resolve, 1800));
            }
            await route.continue();
          });
        }
        const started = Date.now();
        await page.getByRole("button", { name: "New note", exact: true }).click();
        const title = page.getByRole("textbox", { name: "Title", exact: true });
        const body = page.getByRole("textbox", { name: "Document body", exact: true });
        await title.waitFor();
        const createToEditor = Date.now() - started;
        const name = `${marker} ${engine.name()}`;
        await title.fill(name);
        await body.fill(text);
        if (delayedLeave) {
          await page.getByRole("button", { name: "Notes", exact: true }).click();
          await page.waitForTimeout(2200);
          await page.getByRole("button", { name: new RegExp(name) }).click();
          await body.waitFor();
        }
        let saved;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          saved = (await store.getAllPosts(handle)).find((post) => post.title === name);
          if (saved?.id && (await store.getPostById(handle, saved.id))?.body === text) break;
          await page.waitForTimeout(250);
        }
        if (!saved?.id || (await store.getPostById(handle, saved.id))?.body !== text) {
          console.log(JSON.stringify({ url: page.url(), savedId: saved?.id, savedTitle: saved?.title,
            storedBody: saved?.id ? (await store.getPostById(handle, saved.id))?.body : null,
            visibleTitle: await title.inputValue(), visibleBody: await body.textContent(),
            status: await page.locator("[role=status]").allTextContents(), alerts: await page.locator("[role=alert]").allTextContents(), errors }));
          throw Error("The typed note did not reach the server");
        }
        owned.add(saved.id);
        const url = page.url();
        if (new URL(url).searchParams.get("id") !== saved.id) throw Error("The new note did not retain its saved address");
        navigatingAt = Date.now();
        await page.reload({ waitUntil: "domcontentloaded" });
        await body.waitFor();
        await page.waitForFunction((expected) => document.querySelector('[aria-label="Document body"]')?.textContent === expected, text);
        if (await body.textContent() !== text || await title.inputValue() !== name) {
          console.log(JSON.stringify({ phase: "reload", url: page.url(), storedBody: (await store.getPostById(handle, saved.id))?.body, visibleBody: await body.textContent(), visibleTitle: await title.inputValue(), expectedBody: text, errors }));
          throw Error("Reload changed the note");
        }
        await page.screenshot({ path: `/tmp/texttext-artifact/notes-${engine.name()}-editor.png` });
        await go(`${origin}/t/${handle}?pane=notes`);
        await page.getByRole("button", { name: new RegExp(name) }).click();
        await body.waitFor();
        await page.waitForFunction((expected) => document.querySelector('[aria-label="Document body"]')?.textContent === expected, text);
        if (await body.textContent() !== text) throw Error("Reopening changed the note");
        console.log(JSON.stringify({ engine: engine.name(), delayedLeave, createToEditor, saved: true, reloaded: true, reopened: true, errors, navigationCancellations }));
        if (errors.length) throw Error("Browser errors while editing");
      } finally {
        for (const context of browser.contexts()) for (const page of context.pages()) {
          const url = new URL(page.url());
          const id = url.searchParams.get("id");
          if (url.pathname.startsWith(`/t/${handle}/`) && id && !before.has(id)) owned.add(id);
        }
        await browser.close();
      }
    }
  } finally {
    for (const post of await store.getAllPosts(handle)) {
      if (!post.id || before.has(post.id)) continue;
      if (!owned.has(post.id) && !post.title.startsWith(marker)) continue;
      await store.deletePost(handle, post.id);
      await store.permanentlyDeletePost(handle, post.id);
    }
    await closeDatabaseConnections();
  }
}
void main();
