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
import { readVaultItemCommentsFromPack } from "../src/lib/vault/item-comments";
import { listVaultTextpacks } from "../src/lib/vault/server-store";
const origin = process.env.TEXTTEXT_VERIFY_ORIGIN ?? "http://localhost:3000";
const root = path.resolve(process.env.TEXTTEXT_VAULT_ROOT ?? ".texttext/vault-server");
const workspaceId = randomUUID(), itemId = randomUUID(), grantId = randomUUID(), ownerGrantId = randomUUID();
const title = `File collaboration ${workspaceId.slice(0, 8)}`, relativePath = `${title}.textpack`;
const newFolder = `Shared folder ${workspaceId.slice(0, 8)}`;
let addedItemId: string | null = null;
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
    await until(async () => (await alice.getByLabel(/1 person here:/).count()) > 0 &&
      (await bob.getByLabel(/1 person here:/).count()) > 0,
    "both authenticated editors show the other active participant", 35000);
    for (const page of [alice, bob]) await page.getByRole("button", { name: "Comments", exact: true }).click();
    const commentMarker = `Comment-${workspaceId.slice(0, 8)}`;
    await alice.getByRole("textbox", { name: "Add a comment" }).fill(commentMarker);
    await alice.getByRole("button", { name: "Post comment" }).click();
    await until(async () => await bob.getByText(commentMarker, { exact: true }).count() === 1,
      "second account sees a new item comment without reloading", 35000);
    await bob.getByRole("button", { name: "Reply", exact: true }).click();
    await bob.getByRole("textbox", { name: "Reply", exact: true }).fill(`Reply-${commentMarker}`);
    await bob.getByRole("button", { name: "Post reply" }).click();
    await until(async () => await alice.getByText(`Reply-${commentMarker}`, { exact: true }).count() === 1,
      "first account sees a reply without reloading", 35000);
    const commented = await readVaultTextpack({ root, workspaceId, itemId });
    check(commented && readVaultItemCommentsFromPack(commented.bytes, itemId).comments.length === 2,
      "both comments are stored inside the canonical TextPack");
    for (const page of [alice, bob]) await page.getByRole("button", { name: "Close comments" }).click();
    await Promise.all([append(alice, " ALICE-CONCURRENT"), append(bob, "BOB-CONCURRENT ", "start")]);
    const text = (page: Page) => page.getByRole("textbox", { name: "Document body", exact: true }).textContent();
    await until(async () => [await text(alice), await text(bob)].every(value => value?.includes("ALICE-CONCURRENT") && value.includes("BOB-CONCURRENT")), "two different accounts converge in already-open editors");
    await alice.getByRole("textbox", { name: "Document body", exact: true }).focus(); await alice.keyboard.press("ControlOrMeta+z");
    await until(async () => [await text(alice), await text(bob)].every(value => value === "BOB-CONCURRENT Original shared text."), "undo removes only the current writer's complete edit");
    await alice.keyboard.press("ControlOrMeta+Shift+z");
    await until(async () => [await text(alice), await text(bob)].every(value => value === "BOB-CONCURRENT Original shared text. ALICE-CONCURRENT"), "redo restores the current writer's edit on both clients");
    await a.setOffline(true); await append(alice, " ALICE-OFFLINE"); await append(bob, "BOB-ONLINE ", "start"); await a.setOffline(false);
    await until(async () => [await text(alice), await text(bob)].every(value => value === "BOB-ONLINE BOB-CONCURRENT Original shared text. ALICE-CONCURRENT ALICE-OFFLINE"), "offline pending edits converge without losing or relocating text");
    // Same context means the same localStorage, unlike the two-account case above.
    const sibling = await a.newPage();
    sibling.on("pageerror", error => errors.push(error.message));
    sibling.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/collaboration")) pushes++; });
    const sessionCopy = await alice.evaluate(() => Object.entries(sessionStorage));
    await sibling.addInitScript(entries => { for (const [key, value] of entries) sessionStorage.setItem(key, value); }, sessionCopy);
    await sibling.goto(`${origin}/vault/${workspaceId}`, { waitUntil: "domcontentloaded" });
    await sibling.getByRole("button", { name: new RegExp(title) }).first().click();
    await sibling.getByRole("textbox", { name: "Document body", exact: true }).waitFor({ timeout: 20000 });
    const ownedKeys = await alice.evaluate(async id => (await navigator.locks.query()).held?.filter(lock => lock.name?.includes(id)).map(lock => lock.name), itemId);
    check(ownedKeys?.length === 2 && new Set(ownedKeys).size === 2, "same-origin tabs with cloned sessionStorage own separate Web Locks and journals");
    const beforeTabs = await text(alice);
    await a.setOffline(true);
    await Promise.all([append(alice, " SAME-TAB-A"), append(sibling, "SAME-TAB-B ", "start")]);
    const retainedKeys = await alice.evaluate(id => Object.keys(localStorage).filter(key => key.startsWith("texttext:file-collaboration:v1:") && key.includes(id)), itemId);
    check(retainedKeys.length === 2, "both offline tabs retain independent recovery records");
    // Allow app assets/navigation while the collaboration transport stays disconnected.
    const collaborationRoute = `${origin}/api/vault/**/collaboration*`;
    await a.route(collaborationRoute, route => route.abort("internetdisconnected"));
    await a.setOffline(false);
    await alice.reload({ waitUntil: "domcontentloaded" });
    await alice.getByRole("button", { name: new RegExp(title) }).first().click();
    await until(async () => await text(alice) === `${beforeTabs} SAME-TAB-A`, "reloaded tab restores its own unsent edits while collaboration is offline");
    check(await text(sibling) === `SAME-TAB-B ${beforeTabs}`, "reloading one tab preserves the other tab's unsent edits");
    await a.unroute(collaborationRoute);
    const expectedTabs = `SAME-TAB-B ${beforeTabs} SAME-TAB-A`;
    await until(async () => [await text(alice), await text(sibling), await text(bob)].every(value => value === expectedTabs), "same-origin offline edits survive reload and converge exactly on all three editors", 20000);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const settled = pushes; await new Promise(resolve => setTimeout(resolve, 3000));
    check(pushes === settled, "idle editors make no repeat mutation uploads");
    const stored = await readVaultTextpack({ root, workspaceId, itemId });
    check(stored && readDocument(openPack(stored.bytes, relativePath, stored.revision).file).content.body === await text(alice), "canonical TextPack matches the visible shared document");
    await alice.screenshot({ path: "/tmp/texttext-file-collaboration-light.png", fullPage: true });
    await alice.emulateMedia({ colorScheme: "dark" });
    await alice.screenshot({ path: "/tmp/texttext-file-collaboration-dark.png", fullPage: true });
    await alice.getByRole("combobox", { name: "Folder for new items" }).fill(newFolder);
    await alice.getByRole("button", { name: "New note", exact: true }).click();
    await alice.getByText(`${newFolder}/Untitled.textpack`, { exact: true }).waitFor();
    await alice.getByRole("textbox", { name: "Document body", exact: true }).waitFor();
    await append(alice, "Created together in a new folder.");
    await until(async () => {
      const entry = (await listVaultTextpacks({ root, workspaceId })).items.find(value => value.relativePath === `${newFolder}/Untitled.textpack`);
      if (entry) addedItemId = entry.itemId;
      return Boolean(entry);
    }, "first account saves a TextPack in the new folder");
    await until(async () => await bob.getByText(newFolder, { exact: true }).count() === 1,
      "second account sees the new folder without reloading", 35000);
    await bob.locator(`button[title="${newFolder}/Untitled.textpack"]`).click();
    await until(async () => (await text(bob)) === "Created together in a new folder.",
      "second account opens the new folder's note with its live content", 35000);
    await bob.getByRole("button", { name: new RegExp(title) }).first().click();
    await bob.getByRole("textbox", { name: "Document body", exact: true }).waitFor();
    await db.update(collaborators).set({ role: "viewer" }).where(eq(collaborators.id, grantId));
    const denied = await bob.request.post(`${origin}/api/vault/${workspaceId}/items/${itemId}/collaboration`, { headers: { Origin: origin }, data: { operationId: randomUUID(), epoch: 1, updates: ["AAA="] } });
    check(denied.status() === 403, "downgraded participant cannot write");
    await until(async () => await bob.getByText(/Editing access was removed|This file or its access changed|Read only\. You don’t have editing access\./).count() > 0,
      "open editor notices permission downgrade", 35000);
    check(errors.length === 0, `no browser runtime errors (${errors.length})`);
  } catch (error) {
    for (const [index, context] of browser.contexts().entries()) for (const page of context.pages()) {
      await page.screenshot({ path: `/tmp/texttext-file-collaboration-failed-${index}.png`, fullPage: true }).catch(() => {});
      console.error((await page.locator("body").innerText()).slice(-2500));
    }
    throw error;
  } finally {
    await browser.close();
    const fixtureIds = (await listVaultTextpacks({ root, workspaceId }).then(value => value.items.map(item => item.itemId)).catch(() => []));
    await db.delete(actionAudit).where(inArray(actionAudit.targetId, [...new Set([itemId, ...fixtureIds, ...(addedItemId ? [addedItemId] : [])])]));
    await db.delete(collaborators).where(inArray(collaborators.id, [grantId, ownerGrantId]));
    await db.delete(blogs).where(eq(blogs.id, workspaceId));
    await rm(path.join(root, workspaceId), { recursive: true, force: true });
    await closeDatabaseConnections();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
