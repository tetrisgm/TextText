/** Two existing local accounts see folder creation and live note edits. */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getAllPosts, getBlog, getPostById } from "../src/lib/store";
import { blogPostEditPath } from "../src/lib/public-paths";

const origin = process.env.VISUAL_ORIGIN ?? "http://localhost:3000";
const handle = "visual-demo";
const folderPath = `/@${handle}?folder=blog`;
const secondEmail = "second-editor@texttext.local";

async function signedInPage(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${origin}/editor`, { waitUntil: "domcontentloaded" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor();
  await page.waitForFunction(() => {
    const form = document.querySelector("form.ac-devsignin");
    return form && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
  });
  await form.locator("input[type=email]").fill(email);
  await form.locator("button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/editor"));
  return page;
}

async function editorText(page: Page) {
  return page.locator(".tt-document-editor .tt-md-surface").first().innerText();
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Requires local Postgres");
  const browser = await chromium.launch();
  try {
    const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const secondContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const owner = await signedInPage(ownerContext, "visual-demo@texttext.local");
    const second = await signedInPage(secondContext, secondEmail);
    await owner.goto(`${origin}${folderPath}`, { waitUntil: "domcontentloaded" });
    await owner.waitForFunction(() => {
      const button = document.querySelector('button[aria-label="Folder options for Blog"]');
      return button && Object.keys(button).some((key) => key.startsWith("__reactProps$"));
    });
    await owner.getByRole("button", { name: "Folder options for Blog" }).click();
    await owner.getByRole("menuitem", { name: "Share" }).click();
    const share = owner.getByRole("dialog", { name: "Share folder" });
    await share.waitFor();
    await share.getByText("Loading people").waitFor({ state: "hidden" });
    const existing = share.getByRole("combobox", { name: `Role for ${secondEmail}` });
    if (await existing.count()) {
      await existing.selectOption("editor");
    } else {
      await share.getByRole("textbox", { name: "Email" }).fill(secondEmail);
      await share.getByRole("combobox", { name: "Invite role" }).selectOption("editor");
      await share.getByRole("button", { name: "Invite" }).click();
      await share.getByText(`Access granted to ${secondEmail}`, { exact: false }).waitFor();
    }
    await share.getByRole("button", { name: "Close sharing" }).click();
    await owner.locator(".post-folder-page-items").waitFor();
    const directResponse = await second.request.get(`${origin}${folderPath}`, { maxRedirects: 0 });
    if (directResponse.status() !== 200) {
      const session = await second.request.get(`${origin}/api/auth/session`).then((response) => response.json()) as { user?: { email?: string } };
      throw new Error(`Shared folder gate returned ${directResponse.status()} to ${directResponse.headers()["location"]}; signed-in email matches: ${session.user?.email === secondEmail}`);
    }
    const folderResponse = await second.goto(`${origin}${folderPath}`, { waitUntil: "domcontentloaded" });
    if (folderResponse?.status() !== 200) throw new Error(`Shared folder did not open: ${folderResponse?.status()}`);
    const composer = second.locator(".universal-item-composer");
    await composer.waitFor();
    await second.waitForFunction(() => {
      const form = document.querySelector(".universal-item-composer");
      return form && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
    });
    const stamp = crypto.randomUUID();
    const title = `Shared work proof ${stamp}`;
    const initial = `${title}\nA note that both people can edit.`;
    const response = second.waitForResponse((candidate) => candidate.url().endsWith("/api/workspace/folder-capture"));
    await composer.locator("textarea").fill(initial);
    await composer.locator("button[type=submit]").click();
    const captured = await response;
    const payload = await captured.json() as { error?: string; item?: { id: string; slug: string }; receipt?: { itemId: string } };
    if (!captured.ok() || !payload.item?.id || payload.receipt?.itemId !== payload.item.id) {
      throw new Error(`Shared folder capture failed: ${captured.status()} ${payload.error ?? "missing receipt"}`);
    }
    await second.waitForURL((url) => url.pathname.includes("shared-work-proof-"), { timeout: 30000 });
    const matches = (await getAllPosts(handle)).filter((candidate) => candidate.title === title);
    if (matches.length !== 1 || matches[0].id !== payload.item.id) throw new Error(`Shared folder creation produced ${matches.length} matching items`);
    const originalRequest = captured.request().postDataJSON() as Record<string, unknown>;
    const replay = await second.request.post(`${origin}/api/workspace/folder-capture`, {
      headers: { "Content-Type": "application/json", "X-TextText-Capture": "1" },
      data: originalRequest,
    });
    const replayBody = await replay.json() as { item?: { id?: string } };
    if (replay.status() !== 200 || replayBody.item?.id !== payload.item.id) {
      throw new Error(`Capture retry returned ${replay.status()} with a different item`);
    }
    const deniedFolder = await second.request.post(`${origin}/api/workspace/folder-capture`, {
      headers: { "Content-Type": "application/json", "X-TextText-Capture": "1" },
      data: { ...originalRequest, folderPath: "notes/mixed", idempotencyKey: crypto.randomUUID() },
    });
    if (deniedFolder.status() !== 403) throw new Error(`Unshared folder capture returned ${deniedFolder.status()}`);
    const missingHeader = await second.request.post(`${origin}/api/workspace/folder-capture`, {
      headers: { "Content-Type": "application/json" }, data: originalRequest,
    });
    if (missingHeader.status() !== 403) throw new Error(`Missing capture header returned ${missingHeader.status()}`);
    const anonymous = await browser.newContext();
    try {
      const deniedAnonymous = await anonymous.request.post(`${origin}/api/workspace/folder-capture`, {
        headers: { "Content-Type": "application/json", "X-TextText-Capture": "1" }, data: originalRequest,
      });
      if (deniedAnonymous.status() !== 401) throw new Error(`Anonymous capture returned ${deniedAnonymous.status()}`);
    } finally { await anonymous.close(); }
    const replayMatches = (await getAllPosts(handle)).filter((candidate) => candidate.title === title);
    if (replayMatches.length !== 1) throw new Error(`Capture retry created ${replayMatches.length} matching items`);
    const id = payload.item.id;
    const post = await getPostById(handle, id);
    const blog = await getBlog(handle);
    if (!post || !blog || post.type !== "note" || post.visibility !== "private") throw new Error("Shared note did not save privately");
    await owner.getByText(title).first().waitFor({ timeout: 30000 });

    const editPath = blogPostEditPath(blog, post);
    await owner.goto(`${origin}${editPath}`, { waitUntil: "domcontentloaded" });
    await second.goto(`${origin}${editPath}`, { waitUntil: "domcontentloaded" });
    const ownerEditor = owner.locator(".tt-document-editor .tt-md-surface").first();
    const secondEditor = second.locator(".tt-document-editor .tt-md-surface").first();
    await ownerEditor.waitFor();
    await secondEditor.waitFor();
    await owner.waitForFunction(() => {
      const surface = document.querySelector(".tt-document-editor .tt-md-surface");
      return surface && Object.keys(surface).some((key) => key.startsWith("__reactProps$"));
    });
    await second.waitForFunction(() => {
      const surface = document.querySelector(".tt-document-editor .tt-md-surface");
      return surface && Object.keys(surface).some((key) => key.startsWith("__reactProps$"));
    });
    const ownerLine = `Owner addition ${stamp}`;
    const secondLine = `Second person addition ${stamp}`;
    await ownerEditor.click();
    await owner.keyboard.press("Meta+End");
    await owner.keyboard.type(`\n${ownerLine}`);
    await second.waitForFunction((line) => document.querySelector(".tt-document-editor .tt-md-surface")?.textContent?.includes(line), ownerLine, { timeout: 30000 });
    await secondEditor.click();
    await second.keyboard.press("Meta+End");
    await second.keyboard.type(`\n${secondLine}`);
    await owner.waitForFunction((line) => document.querySelector(".tt-document-editor .tt-md-surface")?.textContent?.includes(line), secondLine, { timeout: 30000 });
    if (!(await editorText(owner)).includes(ownerLine) || !(await editorText(second)).includes(secondLine)) throw new Error("Live bodies diverged");
    await owner.screenshot({ path: "/tmp/texttext-ux-shared-note-owner.png", fullPage: true });
    await second.screenshot({ path: "/tmp/texttext-ux-shared-note-second.png", fullPage: true });
    console.log("PASS: folder editor grant, private note creation/retry, denied access, owner sees it without reload, both see live edits");
    await ownerContext.close();
    await secondContext.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message.split("\n")[0] : "Browser verification failed"); process.exitCode = 1; });
