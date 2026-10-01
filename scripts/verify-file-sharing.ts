/** Live local-only sharing acceptance with two existing test accounts.
 * Requires an already running production build and local Postgres.
 * Run: TEXTTEXT_VAULT_ROOT=<local server root> node --env-file=.env.local --import tsx scripts/verify-file-sharing.ts
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { chromium, type Page } from "playwright";
import { db, closeDatabaseConnections } from "../src/lib/db/client";
import { actionAudit, blogs, users, vaultGrants } from "../src/lib/db/schema";
import { deleteVaultTextpack, readVaultTextpack, writeVaultTextpack } from "../src/lib/store";
import { buildTextpack } from "../src/lib/github/textpack";
import { emptyDocumentSnapshot } from "../src/lib/documents/model";

const origin = process.env.TEXTTEXT_VERIFY_ORIGIN ?? "http://localhost:3000";
const root = path.resolve(process.env.TEXTTEXT_VAULT_ROOT ?? ".texttext/vault-server");
const ownerEmail = "ada.live-collab@example.test";
const memberEmail = "grace.live-collab@example.test";
const itemId = randomUUID();
const stamp = itemId.slice(0, 8);
const title = `Scoped sharing ${stamp}`;
const relativePath = `Sharing verification ${stamp}/${title}.textpack`;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); console.log(`PASS ${message}`); }
async function until(probe: () => Promise<boolean>, message: string, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await probe()) { console.log(`PASS ${message}`); return; } await new Promise(resolve => setTimeout(resolve, 200)); }
  throw new Error(message);
}
async function signIn(page: Page, email: string, workspaceId: string) {
  const csrf = await (await page.request.get(`${origin}/api/auth/csrf`)).json();
  const response = await page.request.post(`${origin}/api/auth/callback/dev-login`, {
    form: { csrfToken: csrf.csrfToken, email, callbackUrl: email === memberEmail ? `${origin}/shared` : `${origin}/vault/${workspaceId}` },
  });
  check(response.ok(), "existing test account signed in");
}

async function main() {
  check(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname), "local server required");
  check(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname), "local database required");
  if (!db) throw new Error("Local database required");
  const accounts = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, [ownerEmail, memberEmail]));
  const owner = accounts.find(account => account.email === ownerEmail);
  const member = accounts.find(account => account.email === memberEmail);
  if (!owner || !member) throw new Error("Existing Ada and Grace test accounts are required");
  const workspaces = await db.select({ id: blogs.id }).from(blogs).where(eq(blogs.ownerId, owner.id));
  if (workspaces.length !== 1) throw new Error("The existing Ada test workspace is required");
  const workspaceId = workspaces[0].id;
  const browser = await chromium.launch();
  let created = false;
  try {
    const document = emptyDocumentSnapshot();
    document.content.title = title;
    document.content.body = `A file shared with one invited account (${stamp}).`;
    const written = await writeVaultTextpack({ root, workspaceId, itemId, relativePath, operationId: randomUUID(), baseRevision: null,
      bytes: buildTextpack(title, { document, markdown: `---\ntextTextId: ${itemId}\n---\n\n${document.content.body}` }),
      actorUserId: owner.id, actorType: "human" });
    check(written.status === "written", "test TextPack created in the existing owner workspace");
    created = true;
    const ownerContext = await browser.newContext();
    const memberContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();
    const errors: string[] = [];
    ownerPage.on("pageerror", error => errors.push(error.message));
    memberPage.on("pageerror", error => errors.push(error.message));
    await signIn(ownerPage, ownerEmail, workspaceId);
    await signIn(memberPage, memberEmail, workspaceId);
    const before = await memberPage.request.get(`${origin}/api/vault/${workspaceId}/items/${itemId}`);
    check(before.status() === 404, "uninvited account cannot read the private TextPack");
    await ownerPage.goto(`${origin}/vault/${workspaceId}`, { waitUntil: "domcontentloaded" });
    await ownerPage.locator('nav[aria-label="Workspace files"] button').filter({ hasText: title }).click();
    await ownerPage.getByRole("button", { name: "Share", exact: true }).click();
    await ownerPage.getByRole("textbox", { name: "Email address" }).fill(memberEmail);
    await ownerPage.getByRole("combobox", { name: "Access" }).selectOption("commenter");
    await ownerPage.getByRole("button", { name: "Add access" }).click();
    await until(async () => await ownerPage.getByText(memberEmail, { exact: true }).count() > 0,
      "owner grants this item commenter access by email");
    await ownerPage.getByRole("button", { name: "Close sharing" }).click();
    await memberPage.goto(`${origin}/shared`, { waitUntil: "domcontentloaded" });
    await memberPage.getByRole("link", { name: relativePath }).waitFor({ timeout: 20000 });
    await memberPage.getByRole("link", { name: relativePath }).click();
    await memberPage.getByText(document.content.body, { exact: true }).waitFor({ timeout: 20000 });
    check(true, "invitee discovers and opens only the shared file");
    const deniedEdit = await memberPage.request.post(`${origin}/api/vault/${workspaceId}/items/${itemId}/collaboration`, {
      headers: { Origin: origin }, data: { operationId: randomUUID(), epoch: 1, updates: ["AAA="] },
    });
    check(deniedEdit.status() === 403, "commenter cannot mutate shared document content");
    const deniedResolve = await memberPage.request.patch(`${origin}/api/vault/${workspaceId}/items/${itemId}/comments`, {
      headers: { Origin: origin }, data: { operationId: randomUUID(), commentId: randomUUID(), resolved: true },
    });
    check(deniedResolve.status() === 403, "commenter cannot resolve threads");
    await memberPage.getByRole("button", { name: "Comments", exact: true }).click();
    await memberPage.getByRole("textbox", { name: "Add a comment" }).fill(`Shared comment ${stamp}`);
    await memberPage.getByRole("button", { name: "Post comment" }).click();
    await memberPage.getByText(`Shared comment ${stamp}`, { exact: true }).waitFor({ timeout: 20000 });
    check(true, "commenter writes a comment into the shared TextPack");
    await ownerPage.getByRole("button", { name: "Share", exact: true }).click();
    await ownerPage.getByRole("button", { name: "Remove", exact: true }).click();
    await ownerPage.getByRole("button", { name: "Remove access" }).click();
    await until(async () => (await memberPage.request.get(`${origin}/api/vault/${workspaceId}/items/${itemId}/comments`)).status() === 404,
      "revoked invitee loses item and comment access immediately");
    await memberPage.goto(`${origin}/shared`, { waitUntil: "domcontentloaded" });
    await until(async () => await memberPage.getByRole("link", { name: relativePath }).count() === 0,
      "revoked file disappears from Shared with me");
    check(errors.length === 0, `no browser runtime errors (${errors.length})`);
  } catch (error) {
    console.error("Sharing scenario failed:", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    for (const [index, context] of browser.contexts().entries()) for (const page of context.pages()) {
      await page.screenshot({ path: `/tmp/texttext-file-sharing-failed-${index}.png`, fullPage: true }).catch(() => {});
      console.error((await page.locator("body").innerText()).slice(-1300));
    }
    throw error;
  } finally {
    await browser.close();
    await db.delete(vaultGrants).where(and(eq(vaultGrants.workspaceId, workspaceId), eq(vaultGrants.scopeKey, itemId)));
    if (created) {
      const saved = await readVaultTextpack({ root, workspaceId, itemId });
      if (saved) await deleteVaultTextpack({ root, workspaceId, itemId, operationId: randomUUID(),
        basePath: relativePath, baseRevision: saved.revision, actorUserId: owner.id, actorType: "human" });
    }
    await db.delete(actionAudit).where(inArray(actionAudit.targetId, [itemId, `${workspaceId}:${itemId}`]));
    await closeDatabaseConnections();
  }
}
main().catch(error => { console.error("Sharing check stopped:", error instanceof Error ? `${error.name}: ${error.message}` : String(error)); process.exitCode = 1; });
