/** Live, local-only RSS acceptance. A subscription and one kept article are
 * created through the UI in an exact disposable folder, then deleted from the
 * file vault after verifying their complete TextPack bytes.
 *
 * TEXTTEXT_VAULT_ROOT=<local root> node --env-file=.env.local --import tsx scripts/verify-file-rss.ts
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { chromium } from "playwright";
import { db, closeDatabaseConnections } from "../src/lib/db/client";
import { actionAudit, blogs, users } from "../src/lib/db/schema";
import { deleteVaultTextpack, listVaultTextpacks, readVaultTextpack } from "../src/lib/store";
import { parseTextpack } from "../src/lib/github/textpack";
import { FEED_SUBSCRIPTION_FIELD, KEPT_FEED_ENTRY_FIELD } from "../src/lib/vault/rss";

const origin = process.env.TEXTTEXT_VERIFY_ORIGIN ?? "http://localhost:3000";
const root = path.resolve(process.env.TEXTTEXT_VAULT_ROOT ?? ".texttext/vault-server");
const email = "ada.live-collab@example.test";
const feedURL = "https://www.nasa.gov/news-release/feed/";
const folder = "RSS verification " + randomUUID().slice(0, 8);
const prefix = folder + "/";

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
  console.log("PASS " + label);
}

async function folderItems(workspaceId: string) {
  const listing = await listVaultTextpacks({ root, workspaceId });
  return listing.items.filter((item) => item.relativePath.startsWith(prefix));
}

async function main() {
  check(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname), "local server required");
  check(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL ?? "").hostname), "local database required");
  if (!db) throw new Error("Local database required");
  const [account] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  check(account, "existing Ada test account exists");
  const [workspace] = await db.select({ id: blogs.id }).from(blogs).where(eq(blogs.ownerId, account.id)).limit(1);
  check(workspace, "existing Ada workspace exists");
  const workspaceId = workspace.id;
  check((await folderItems(workspaceId)).length === 0, "verification folder starts empty");

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const csrf = await (await page.request.get(origin + "/api/auth/csrf")).json() as { csrfToken: string };
    const login = await page.request.post(origin + "/api/auth/callback/dev-login", {
      form: { csrfToken: csrf.csrfToken, email, callbackUrl: origin + "/vault/" + workspaceId },
    });
    check(login.ok(), "existing test account signed in");
    await page.goto(origin + "/vault/" + workspaceId, { waitUntil: "domcontentloaded" });

    await page.locator("details.vault-context-menu").getByLabel("More actions", { exact: true }).click();
    const subscribeButton = page.locator(".vault-context-menu-items").getByRole("button", { name: "Subscribe to a feed" });
    await subscribeButton.click();
    const dialog = page.getByRole("dialog", { name: "Subscribe to a feed" });
    await dialog.getByLabel("Folder").fill(folder);
    await dialog.getByLabel("Website or feed address").fill(feedURL);
    await dialog.getByRole("button", { name: "Find feeds" }).click();
    await dialog.getByRole("button", { name: "Subscribe", exact: true }).first().waitFor({ timeout: 45000 });
    await dialog.getByRole("button", { name: "Subscribe", exact: true }).first().click();
    await dialog.waitFor({ state: "hidden" });
    check(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "More actions"),
      "Subscribe returns keyboard focus to the contextual menu");

    const reader = page.locator('section[aria-label$=" feed"]');
    await reader.locator("ol li").first().waitFor({ timeout: 45000 });
    const subscriptionOnly = await folderItems(workspaceId);
    check(subscriptionOnly.length === 1, "subscription creates one TextPack and no feed entries");
    const subscription = await readVaultTextpack({ root, workspaceId, itemId: subscriptionOnly[0].itemId });
    check(subscription, "subscription TextPack is readable");
    const subscriptionPack = parseTextpack(subscription.bytes);
    const subscriptionDocument = subscriptionPack.document as { content?: { fields?: Record<string, unknown> } };
    check(subscriptionDocument.content?.fields?.[FEED_SUBSCRIPTION_FIELD] === "v1", "subscription marker is in validated document");
    check(subscriptionDocument.content?.fields?.feedUrl === feedURL, "subscription keeps source address");

    await reader.getByRole("button", { name: "Keep", exact: true }).first().click();
    await reader.getByText(/^Kept “/).waitFor({ timeout: 45000 });
    const afterKeep = await folderItems(workspaceId);
    check(afterKeep.length === 2, "Keep creates exactly one article TextPack in the same folder");
    const keptItem = afterKeep.find((item) => item.itemId !== subscriptionOnly[0].itemId);
    check(keptItem, "kept item has its own identity");
    const kept = await readVaultTextpack({ root, workspaceId, itemId: keptItem.itemId });
    check(kept, "kept article TextPack is readable");
    const keptPack = parseTextpack(kept.bytes);
    const keptDocument = keptPack.document as { content?: { body?: string; fields?: Record<string, unknown> } };
    check(keptDocument.content?.fields?.[KEPT_FEED_ENTRY_FIELD] === "v1", "kept article records feed provenance");
    check(Boolean(keptDocument.content?.body?.trim()) && "feed-entry.json" in (keptPack.files ?? {}),
      "kept article contains source text and portable entry record");

    await page.reload({ waitUntil: "domcontentloaded" });
    const openPath = async (relativePath: string) => {
      await page.keyboard.press("Meta+k");
      const commands = page.getByRole("dialog", { name: "Search and actions", exact: true });
      await commands.getByRole("searchbox", { name: "Search workspace" }).fill(relativePath);
      await commands.getByText(relativePath, { exact: true }).first().click();
    };
    await openPath(subscriptionOnly[0].relativePath);
    await page.locator('section[aria-label$=" feed"] ol li').first().waitFor({ timeout: 45000 });
    await openPath(keptItem.relativePath);
    await page.locator(`.vault-context-header h2[title="${keptItem.relativePath}"]`).waitFor({ timeout: 20000 });
    check(true, "subscription and kept article reopen through the ordinary command surface");

    const searchButton = page.getByRole("button", { name: /Search and actions/ });
    await searchButton.focus();
    await page.keyboard.press("Meta+k");
    const search = page.getByRole("dialog", { name: "Search and actions" });
    await search.getByRole("searchbox", { name: "Search workspace" }).fill(folder);
    await search.getByText("Searches filenames and folder paths in this workspace.").waitFor();
    await search.getByText(subscriptionOnly[0].relativePath, { exact: true }).first().waitFor({ timeout: 20000 });
    await page.keyboard.press("Escape");
    await search.waitFor({ state: "hidden" });
    check(await page.evaluate(() => document.activeElement?.textContent?.includes("Search and actions")),
      "Command-K search returns focus to its opener");
    check(errors.length === 0, "no browser runtime errors");
  } finally {
    await browser.close();
    const created = await folderItems(workspaceId);
    for (const item of created) {
      const current = await readVaultTextpack({ root, workspaceId, itemId: item.itemId });
      if (!current) continue;
      await deleteVaultTextpack({ root, workspaceId, itemId: item.itemId, operationId: randomUUID(),
        basePath: item.relativePath, baseRevision: current.revision, actorUserId: account.id, actorType: "human" });
    }
    if (created.length) await db.delete(actionAudit).where(inArray(actionAudit.targetId,
      created.flatMap((item) => [item.itemId, workspaceId + ":" + item.itemId])));
    await closeDatabaseConnections();
  }
}

main().catch((error) => {
  console.error("RSS acceptance failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
