/** Local-only, disposable browser acceptance against an already running build.
 * Uses two existing test accounts; never creates accounts or starts a service.
 * Run: node --env-file=.env.local --import tsx scripts/verify-file-collaboration.ts
 */
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { chromium, type Page } from "playwright";
import { db, closeDatabaseConnections } from "../src/lib/db/client";
import { users, blogs, collaborators, actionAudit } from "../src/lib/db/schema";
import { writeVaultTextpack, readVaultTextpack } from "../src/lib/store";
import { buildTextpack } from "../src/lib/github/textpack";
import { emptyDocumentSnapshot } from "../src/lib/documents/model";
import { openPack } from "../src/local-vault/pack";
import { readDocument } from "../src/local-vault/model";
const origin = process.env.TEXTTEXT_VERIFY_ORIGIN ?? "http://localhost:3000";
const root = path.resolve(process.env.TEXTTEXT_VAULT_ROOT ?? ".texttext/vault-server");
const workspaceId = randomUUID(), itemId = randomUUID(), grantId = randomUUID(), ownerGrantId = randomUUID();
const title = `File collaboration ${workspaceId.slice(0, 8)}`, relativePath = `${title}.textpack`;
const emails = ["ada.live-collab@example.test", "grace.live-collab@example.test"];
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); console.log(`PASS ${message}`); }
async function until(probe: () => Promise<boolean>, message: string, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await probe()) { console.log(`PASS ${message}`); return; } await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error(message);
}
async function signIn(page: Page, email: string) {
  const csrf = await (await page.request.get(`${origin}/api/auth/csrf`)).json();
  const response = await page.request.post(`${origin}/api/auth/callback/dev-login`, { form: { csrfToken: csrf.csrfToken, email, callbackUrl: `${origin}/vault/${workspaceId}` } });
  check(response.ok(), "existing test account signed in");
  await page.goto(`${origin}/vault/${workspaceId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: new RegExp(title) }).first().click();
  await page.getByRole("textbox", { name: "Document body", exact: true }).waitFor({ timeout: 20000 });
}
async function append(page: Page, text: string, edge: "start" | "end" = "end") {
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.focus(); await page.keyboard.press(process.platform === "darwin" ? (edge === "end" ? "Meta+ArrowDown" : "Meta+ArrowUp") : (edge === "end" ? "Control+End" : "Control+Home")); await page.keyboard.type(text, { delay: 20 });
}
async function main() {
  check(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname), "local server required");
  check(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname), "local database required");
  if (!db) throw new Error("Local database required");
  const accounts = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, emails));
  const owner = accounts.find(value => value.email === emails[0]), member = accounts.find(value => value.email === emails[1]);
  if (!owner || !member) throw new Error("Existing Ada and Grace test accounts are required");
  const browser = await chromium.launch();
  try {
    await db.insert(blogs).values({ id: workspaceId, handle: `file-collab-${workspaceId}`, name: title, ownerId: null });
    await db.insert(collaborators).values([{ id: ownerGrantId, scopeType: "workspace", scopeId: workspaceId, userId: owner.id, invitedById: owner.id, role: "admin" }, { id: grantId, scopeType: "workspace", scopeId: workspaceId, userId: member.id, invitedById: owner.id, role: "member" }]);
    const document = emptyDocumentSnapshot(); document.content.title = title; document.content.body = "Original shared text.";
    await writeVaultTextpack({ root, workspaceId, itemId, relativePath, operationId: randomUUID(), baseRevision: null,
      bytes: buildTextpack("Shared", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\nOriginal shared text.` }), actorUserId: owner.id, actorType: "human" });
    const a = await browser.newContext(), b = await browser.newContext();
    const alice = await a.newPage(), bob = await b.newPage();
    const errors: string[] = [];
    alice.on("pageerror", error => errors.push(error.message)); bob.on("pageerror", error => errors.push(error.message));
    let pushes = 0;
    for (const page of [alice, bob]) page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/collaboration")) pushes++; });
    await signIn(alice, emails[0]); await signIn(bob, emails[1]);
    await Promise.all([append(alice, " ALICE-CONCURRENT"), append(bob, "BOB-CONCURRENT ", "start")]);
    const text = (page: Page) => page.getByRole("textbox", { name: "Document body", exact: true }).textContent();
    await until(async () => [await text(alice), await text(bob)].every(value => value?.includes("ALICE-CONCURRENT") && value.includes("BOB-CONCURRENT")), "two different accounts converge in already-open editors");
    await alice.getByRole("textbox", { name: "Document body", exact: true }).focus(); await alice.keyboard.press("ControlOrMeta+z");
    await until(async () => [await text(alice), await text(bob)].every(value => value === "BOB-CONCURRENT Original shared text."), "undo removes only the current writer's complete edit");
    await alice.keyboard.press("ControlOrMeta+Shift+z");
    await until(async () => [await text(alice), await text(bob)].every(value => value === "BOB-CONCURRENT Original shared text. ALICE-CONCURRENT"), "redo restores the current writer's edit on both clients");
    await a.setOffline(true); await append(alice, " ALICE-OFFLINE"); await append(bob, "BOB-ONLINE ", "start"); await a.setOffline(false);
    await until(async () => [await text(alice), await text(bob)].every(value => value === "BOB-ONLINE BOB-CONCURRENT Original shared text. ALICE-CONCURRENT ALICE-OFFLINE"), "offline pending edits converge without losing or relocating text");
    await new Promise(resolve => setTimeout(resolve, 1500));
    const settled = pushes; await new Promise(resolve => setTimeout(resolve, 3000));
    check(pushes === settled, "idle editors make no repeat mutation uploads");
    const stored = await readVaultTextpack({ root, workspaceId, itemId });
    check(stored && readDocument(openPack(stored.bytes, relativePath, stored.revision).file).content.body === await text(alice), "canonical TextPack matches the visible shared document");
    await alice.screenshot({ path: "/tmp/texttext-file-collaboration-light.png", fullPage: true });
    await alice.emulateMedia({ colorScheme: "dark" });
    await alice.screenshot({ path: "/tmp/texttext-file-collaboration-dark.png", fullPage: true });
    await db.update(collaborators).set({ role: "viewer" }).where(eq(collaborators.id, grantId));
    const denied = await bob.request.post(`${origin}/api/vault/${workspaceId}/items/${itemId}/collaboration`, { headers: { Origin: origin }, data: { operationId: randomUUID(), epoch: 1, updates: ["AAA="] } });
    check(denied.status() === 403, "downgraded participant cannot write");
    await until(async () => await bob.getByText(/Editing access was removed/).count() > 0, "open editor notices permission downgrade", 35000);
    check(errors.length === 0, `no browser runtime errors (${errors.length})`);
  } catch (error) {
    for (const [index, context] of browser.contexts().entries()) for (const page of context.pages()) {
      await page.screenshot({ path: `/tmp/texttext-file-collaboration-failed-${index}.png`, fullPage: true }).catch(() => {});
      console.error((await page.locator("body").innerText()).slice(-2500));
    }
    throw error;
  } finally {
    await browser.close();
    await db.delete(actionAudit).where(eq(actionAudit.targetId, itemId));
    await db.delete(collaborators).where(inArray(collaborators.id, [grantId, ownerGrantId]));
    await db.delete(blogs).where(eq(blogs.id, workspaceId));
    await rm(path.join(root, workspaceId), { recursive: true, force: true });
    await closeDatabaseConnections();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
