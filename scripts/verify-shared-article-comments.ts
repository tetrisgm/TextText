/** Two existing local accounts comment on one private saved article. */
import { chromium, type BrowserContext, type Page } from "playwright";

const origin = process.env.VISUAL_ORIGIN ?? "http://localhost:3000";
const path = "/@visual-demo/notes/mixed-workspace-check/probe-bookmark-capture";
const postId = "11111111-2222-4333-8444-555555555501";
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

async function waitForComments(page: Page) {
  await page.waitForFunction(() => {
    const layer = document.querySelector("[data-reader-comments]");
    return layer && Object.keys(layer).some((key) => key.startsWith("__reactProps$"));
  });
  await page.waitForTimeout(100);
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
    const initialStatus = (await second.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" }))?.status() ?? 0;
    if (![200, 403, 404].includes(initialStatus)) throw new Error(`Unexpected initial access status ${initialStatus}`);

    await owner.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
    await owner.getByText("Choose where the conversation lives").waitFor();
    if (initialStatus !== 200) {
      await owner.waitForFunction(() => {
        const button = document.querySelector('button[aria-label="Share post"]');
        return button && Object.keys(button).some((key) => key.startsWith("__reactProps$"));
      });
      await owner.getByRole("button", { name: "Share post" }).click();
      await owner.getByRole("dialog", { name: "Share" }).getByRole("button", { name: "Invite people" }).click();
      const share = owner.getByRole("dialog", { name: "Share", exact: true });
      await share.getByRole("textbox", { name: "Email" }).fill(secondEmail);
      await share.getByRole("combobox", { name: "Invite role" }).selectOption("commenter");
      await share.getByRole("button", { name: "Invite" }).click();
      await share.getByText(`Access granted to ${secondEmail}`, { exact: false }).waitFor();
      await owner.getByRole("button", { name: "Close sharing" }).click();
    }

    const finalStatus = (await second.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" }))?.status() ?? 0;
    if (finalStatus !== 200) throw new Error(`Commenter cannot read the shared article: ${finalStatus}`);
    await second.getByText("Choose where the conversation lives").waitFor();
    await waitForComments(second);
    if (await second.getByRole("button", { name: "Edit post" }).count()) throw new Error("Commenter received an edit control");
    const editStatus = await second.evaluate(async (id) =>
      (await fetch("/api/ai/tools", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ handle: "visual-demo", name: "update_item", args: { id, title: "Texttext AI setup guide" } }),
      })).status,
    postId);
    if (editStatus !== 403) throw new Error(`Commenter edit was not denied with 403: ${editStatus}`);
    const comment = `The source remains visible to a collaborator. ${crypto.randomUUID()}`;
    await second.getByRole("button", { name: "Comments", exact: true }).click();
    const comments = second.getByRole("dialog", { name: "Comments" });
    await comments.getByRole("textbox", { name: "Add a comment" }).fill(comment);
    await comments.getByRole("button", { name: "Post" }).click();
    await second.getByRole("status").filter({ hasText: "Comment posted." }).waitFor();

    await waitForComments(owner);
    await owner.bringToFront();
    await owner.getByRole("button", { name: "Comments", exact: true }).click();
    await owner.getByRole("dialog", { name: "Comments" }).getByText(comment).waitFor({ timeout: 25000 });
    await owner.screenshot({ path: "/tmp/texttext-ux-shared-article-comments.png", fullPage: true });
    console.log(`PASS: initial access ${initialStatus}, commenter reads and comments, edit denied 403, owner sees comment without reload`);
    await ownerContext.close();
    await secondContext.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message.split("\n")[0] : "Browser verification failed"); process.exitCode = 1; });
