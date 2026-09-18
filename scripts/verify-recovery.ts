// Destroy a paragraph the way a person does, and prove it comes back.
//
// This is the one check that goes through the whole chain rather than a piece
// of it: a real browser types into the collaborative editor, the relay carries
// it, materialization writes it to the row, the same statement records the
// version it replaced, a select-all-and-type-over destroys it, and the restore
// puts it back into the open document. Every other test here proves one link.
//
// It is the owner's own accident, run on purpose. A note was written, the tab
// was closed, and two words came back. Everything built since then exists to
// make that impossible, and this is the only thing that checks the whole of it
// end to end, in the browser, against a production build.
//
// It also checks the part people forget: that the restore is itself undoable.
// A recovery that destroys what it replaced has only moved the loss.
//
//   npm run verify:recovery
//   npx tsx scripts/verify-recovery.ts --origin http://localhost:3100
//
// It writes and destroys a note of its own, so it cannot damage anybody's
// work. Needs a production build served with AUTH_DEV_LOGIN=1:
//   AUTH_DEV_LOGIN=1 npm run build && AUTH_DEV_LOGIN=1 npx next start -p 3100

import { loadEnvConfig } from "@next/env";
import { chromium, type Page } from "playwright";
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const argOf = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const ORIGIN = argOf("--origin") ?? "http://localhost:3100";
const HANDLE = argOf("--handle") ?? "showcase";

async function signIn(page: Page) {
  await page.goto(`${ORIGIN}/api/auth/csrf`, { waitUntil: "domcontentloaded" });
  const csrfToken = JSON.parse(await page.locator("body").first().innerText()).csrfToken as string;
  await page.request.post(`${ORIGIN}/api/auth/callback/dev-login`, {
    form: { csrfToken, email: `${HANDLE}@texttext.dev`, name: HANDLE, callbackUrl: "/" },
  });
}

const BODY = `document.querySelector('[aria-label="Document body"]')`;
const bodyText = `(${BODY} ? ${BODY}.textContent : null)`;
const focusEnd = `(() => {
  const body = ${BODY};
  if (!body) return false;
  body.focus();
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
})()`;

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Local Postgres only. This writes and destroys a note, and is not for the production database.");
  }
  const store = await import("../src/lib/store");
  const folders = await store.getFolders(HANDLE);
  const notes = folders.find((f) => f.mode === "notes")!;
  const note = await store.createDraftInFolder(HANDLE, notes.id, {
    initial: { type: "note", title: "History probe", body: "ORIGINAL-TEXT the first thing anybody wrote here\n" },
  });
  const id = note.id!;
  const path = `/t/${HANDLE}/${notes.path}/${note.slug}?edit=1&id=${id}`;
  const step = (m: string) => console.log(`  ${m}`);
  const browser = await chromium.launch();
  let failed = false;
  try {
    const page = await browser.newPage();
    await signIn(page);
    await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[aria-label="Document body"]');
    await page.waitForTimeout(2500);
    step(`opened "${note.title}"`);

    // Write something worth keeping, and let it be saved for real.
    await page.evaluate(focusEnd);
    await page.keyboard.type("\nA-VERSION the paragraph that must be recoverable\n", { delay: 8 });
    await page.waitForTimeout(4000);

    // Now destroy it the way a person does: select all in the body and type over it.
    await page.evaluate(`(() => {
      const body = ${BODY};
      body.focus();
      const range = document.createRange();
      range.selectNodeContents(body);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    })()`);
    await page.keyboard.type("B-VERSION two words", { delay: 8 });
    await page.waitForTimeout(5000);
    const wrecked = ((await page.evaluate(bodyText)) as string) ?? "";
    step(`overwrote it; the body is now ${JSON.stringify(wrecked.slice(0, 60))}`);
    if (wrecked.includes("A-VERSION")) {
      console.log("  the overwrite did not take; the probe proves nothing");
      failed = true;
    }

    // What the server kept.
    const versions = await page.request.get(`${ORIGIN}/api/workspace/history?handle=${HANDLE}&id=${id}`);
    type Listed = { id: string; createdAt: string; bodyLength: number; shrankBy: number; action: string; preview: string };
    const listed = (await versions.json()) as { versions?: Listed[] };
    step(`history has ${listed.versions?.length ?? 0} versions`);
    let restorable: string | null = null;
    for (const version of listed.versions ?? []) {
      step(`  ${version.id.slice(0, 8)}  ${version.action}  ${version.bodyLength} chars, shrank by ${version.shrankBy}  ${JSON.stringify(version.preview.slice(0, 90))}`);
      if (!restorable && version.preview.includes("A-VERSION")) restorable = version.id;
    }
    if (!restorable) {
      console.log("  NO VERSION ON FILE HOLDS THE LOST PARAGRAPH");
      failed = true;
    } else {
      step(`version ${restorable.slice(0, 8)} still holds it`);
      const put = await page.request.post(`${ORIGIN}/api/workspace/history`, {
        data: { handle: HANDLE, id, versionId: restorable },
        headers: { "Content-Type": "application/json" },
      });
      step(`restore answered ${put.status()}`);
      if (!put.ok()) failed = true;
      await page.waitForTimeout(2500);
      const after = (await store.getPostById(HANDLE, id))!;
      step(`the stored body now ${after.body?.includes("A-VERSION") ? "HOLDS" : "DOES NOT HOLD"} the paragraph`);
      if (!after.body?.includes("A-VERSION")) failed = true;
      // And the open editor was told, rather than sitting on the old text.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[aria-label="Document body"]');
      await page.waitForTimeout(2500);
      const shown = ((await page.evaluate(bodyText)) as string) ?? "";
      step(`the reopened editor ${shown.includes("A-VERSION") ? "shows" : "DOES NOT SHOW"} it`);
      if (!shown.includes("A-VERSION")) failed = true;
      // The restore is itself undoable: B must still be on file.
      const again = await page.request.get(`${ORIGIN}/api/workspace/history?handle=${HANDLE}&id=${id}`);
      const back = (await again.json()) as { versions?: Listed[] };
      const keptB = (back.versions ?? []).some((version) => version.preview.includes("B-VERSION"));
      step(`the version the restore replaced is ${keptB ? "also on file" : "GONE, so the restore cannot be undone"}`);
      if (!keptB) failed = true;
    }
  } finally {
    await browser.close();
    await store.deletePost(HANDLE, id);
    await store.permanentlyDeletePost(HANDLE, id);
    const { closeDatabaseConnections } = await import("../src/lib/db/client");
    await closeDatabaseConnections();
  }
  console.log(failed ? "\n  HISTORY DID NOT BRING THE TEXT BACK\n" : "\n  Text overwritten in the editor came back from history, and the restore is itself undoable.\n");
  process.exit(failed ? 1 : 0);
};
void main();
