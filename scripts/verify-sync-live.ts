// Live end-to-end proof of the bulletproof sync layer against PRODUCTION.
//
// Stands up a fully isolated scratch workspace (a throwaway user + blog + token
// + post), exercises the real /api/sync/v1 HTTP endpoints on prod to demonstrate
// the revision compare-and-swap, create idempotency, stale-delete rejection, and
// the durable change cursor, then tears EVERYTHING down in a finally. Never
// touches any real workspace.
//
//   DATABASE_URL=... npx tsx scripts/verify-sync-live.ts
//
// (The scratch data lives in the same prod DB but is clearly namespaced and
// deleted at the end; this is the established create-and-clean-up test pattern.)

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  apiTokens,
  blogs,
  folders,
  idempotencyKeys,
  posts,
  users,
  actionAudit,
} from "@/lib/db/schema";
import { ensureWorkspaceFolders } from "@/lib/store";
import { generateApiToken, hashApiToken } from "@/lib/api-tokens";

const ORIGIN = "https://write.ramine.net";
const STAMP = Date.now().toString(36);
const SUB = `scratch-sync-verify-${STAMP}`;
const HANDLE = `scratch-sync-verify-${STAMP}`;

const pass: string[] = [];
const fail: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  (ok ? pass : fail).push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

async function main() {
  if (!db) throw new Error("DATABASE_URL required");
  const token = generateApiToken();
  const auth = { Authorization: `Bearer ${token}` };
  let userId = "";
  let blogId = "";

  try {
    // ---- Setup: isolated scratch workspace ----
    const [u] = await db
      .insert(users)
      .values({ appleSub: SUB, username: HANDLE, name: "Scratch Verify" })
      .returning({ id: users.id });
    userId = u.id;
    const [b] = await db
      .insert(blogs)
      .values({ handle: HANDLE, name: "Scratch Verify", ownerId: userId })
      .returning({ id: blogs.id });
    blogId = b.id;
    await ensureWorkspaceFolders(blogId);
    await db
      .insert(apiTokens)
      .values({ userId, name: "scratch-verify", tokenHash: hashApiToken(token), scopes: "sync" });
    console.log(`scratch workspace ${HANDLE} ready; hitting ${ORIGIN}\n`);

    const api = (path: string, init?: RequestInit) =>
      fetch(`${ORIGIN}${path}`, { ...init, headers: { ...auth, ...(init?.headers || {}) } });

    // ---- 1. Create idempotency: same key -> same item, no duplicate ----
    const body1 = "---\ntype: article\ntitle: Idem\n---\n\nhello";
    const key = `idem-${STAMP}`;
    const c1 = await api("/api/sync/v1/files", {
      method: "POST",
      headers: { "Content-Type": "text/markdown", "Idempotency-Key": key },
      body: body1,
    });
    const j1 = await c1.json();
    const c2 = await api("/api/sync/v1/files", {
      method: "POST",
      headers: { "Content-Type": "text/markdown", "Idempotency-Key": key },
      body: body1,
    });
    const j2 = await c2.json();
    const idemId = j1?.item?.id;
    check(
      "idempotent create returns the SAME item on retry (no duplicate)",
      c1.status === 201 && c2.status === 201 && idemId && j2?.item?.id === idemId,
      `ids ${idemId} == ${j2?.item?.id}`,
    );

    // ---- 2. Revision CAS: two PUTs on the same base -> one 200, one 412 ----
    const getf = await api(`/api/sync/v1/files/${idemId}`);
    const baseHash = getf.headers.get("etag") || "";
    console.log(`   [debug] GET status=${getf.status} etag=${JSON.stringify(baseHash)} manifestHash=${JSON.stringify(j1?.item?.hash)}`);
    const put = (n: number) =>
      api(`/api/sync/v1/files/${idemId}`, {
        method: "PUT",
        headers: { "Content-Type": "text/markdown", "If-Match": baseHash },
        body: `---\ntype: article\ntitle: Edit ${n}\n---\n\nedit ${n}`,
      });
    const [pa, pb] = await Promise.all([put(1), put(2)]);
    const statuses = [pa.status, pb.status].sort();
    console.log(`   [debug] PUT a=${pa.status} "${await pa.clone().text()}"  b=${pb.status} "${await pb.clone().text()}"`);
    check(
      "two concurrent PUTs on one base: exactly one 200, one 412 (compare-and-swap)",
      statuses[0] === 200 && statuses[1] === 412,
      `statuses ${statuses.join("/")}`,
    );

    // ---- 3. Stale delete rejected (412), then correct delete (204) ----
    const cur = await api(`/api/sync/v1/files/${idemId}`);
    const freshHash = cur.headers.get("etag") || "";
    const staleDel = await api(`/api/sync/v1/files/${idemId}`, {
      method: "DELETE",
      headers: { "If-Match": baseHash }, // the pre-edit hash: stale
    });
    check("stale DELETE (old If-Match) is rejected 412", staleDel.status === 412, `status ${staleDel.status}`);
    const goodDel = await api(`/api/sync/v1/files/${idemId}`, {
      method: "DELETE",
      headers: { "If-Match": freshHash },
    });
    check("current DELETE (fresh If-Match) succeeds 204", goodDel.status === 204, `status ${goodDel.status}`);

    // ---- 4. Durable change cursor advances on a mutation ----
    const ch0 = await (await api("/api/sync/v1/changes")).json();
    const cur0 = ch0.cursor;
    await api("/api/sync/v1/files", {
      method: "POST",
      headers: { "Content-Type": "text/markdown" },
      body: "---\ntype: article\ntitle: Cursor bump\n---\n\nx",
    });
    const ch1 = await (await api(`/api/sync/v1/changes?cursor=${encodeURIComponent(cur0)}`)).json();
    check(
      "durable change cursor advances after a mutation (changed:true, cursor moved)",
      ch1.changed === true && ch1.cursor !== cur0,
      `${cur0} -> ${ch1.cursor}`,
    );
  } finally {
    // ---- Teardown: delete ALL scratch data (children first) ----
    if (blogId) {
      await db.delete(posts).where(eq(posts.blogId, blogId));
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.blogId, blogId));
      await db.delete(folders).where(eq(folders.blogId, blogId));
      await db.delete(blogs).where(eq(blogs.id, blogId));
    }
    if (userId) {
      await db.delete(apiTokens).where(eq(apiTokens.userId, userId));
      await db.delete(actionAudit).where(eq(actionAudit.actorUserId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    console.log("\nscratch workspace torn down.");
  }

  console.log(`\n==== ${pass.length} passed, ${fail.length} failed ====`);
  if (fail.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
