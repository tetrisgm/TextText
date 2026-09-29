/** Check the item participant action enters the in-app assistant first. */
import { chromium } from "playwright";
import { getAllPosts, getBlog } from "../src/lib/store";
import { blogPostEditPath } from "../src/lib/public-paths";

const origin = process.env.VISUAL_ORIGIN ?? "http://localhost:3000";
const handle = "visual-demo";

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Requires local Postgres");
  const blog = await getBlog(handle);
  const post = (await getAllPosts(handle)).filter((item) => item.title.startsWith("Shared work proof ")).at(-1);
  if (!blog || !post) throw new Error("Shared-work fixture is missing");
  const browser = await chromium.launch();
  let stage = "sign in";
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${origin}/editor`, { waitUntil: "domcontentloaded" });
    const form = page.locator("form.ac-devsignin");
    await form.waitFor();
    await page.waitForFunction(() => {
      const form = document.querySelector("form.ac-devsignin");
      return form && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
    });
    await form.locator("input[type=email]").fill("visual-demo@texttext.local");
    await form.locator("button[type=submit]").click();
    await page.waitForURL((url) => !url.pathname.startsWith("/editor"));

    stage = "open item";
    await page.goto(`${origin}${blogPostEditPath(blog, post)}`, { waitUntil: "domcontentloaded" });
    await page.locator(".tt-document-editor .tt-md-surface").first().waitFor();
    const addAgent = page.getByRole("button", { name: "Add agent" }).first();
    await page.waitForFunction(() => {
      const button = document.querySelector('button[aria-label="Add agent"]');
      return button && Object.keys(button).some((key) => key.startsWith("__reactProps$"));
    });
    await addAgent.click();

    stage = "agent sheet";
    const sheet = page.getByRole("dialog", { name: "Add your agent" });
    await sheet.waitFor({ timeout: 3000 });
    await sheet.getByRole("button", { name: "Work in TextText" }).waitFor();
    if (await sheet.getByText("Copy your token once").count()) throw new Error("Token setup appeared in the primary flow");
    await page.screenshot({ path: "/tmp/texttext-ux-add-agent-sheet.png", fullPage: true });
    stage = "external options";
    await sheet.getByRole("button", { name: "Other connection methods" }).click();
    await sheet.getByRole("combobox", { name: "Client" }).waitFor({ timeout: 3000 });
    await sheet.getByRole("button", { name: "Other connection methods" }).click();

    stage = "open assistant";
    await sheet.getByRole("button", { name: "Work in TextText" }).click();
    await sheet.waitFor({ state: "hidden" });
    const assistant = page.locator('[data-assistant-sidebar][data-state="pinned"]');
    await assistant.waitFor();
    stage = "selected item context";
    await assistant.getByText(post.title, { exact: true }).first().waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/texttext-ux-add-agent-entry.png", fullPage: true });
    console.log("PASS: Add agent starts in TextText on the selected item; external configuration stays secondary");
  } catch (error) {
    console.error(`Add agent stage failed: ${stage}: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`);
    throw new Error("Add agent browser verification failed");
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message.split("\n")[0] : "Browser verification failed"); process.exitCode = 1; });
