// Live end-to-end proof of the bulletproof sync layer against PRODUCTION.
//
// Stands up a fully isolated scratch workspace (a throwaway user + blog + token
// + post), exercises the real /api/sync/v1 HTTP endpoints on prod to demonstrate
// revision compare-and-swap, metadata compare-and-swap, portable titles,
// historical-slug redirects, stale-delete rejection, and the durable change
// cursor, then tears EVERYTHING down in a finally. Never
// touches any real workspace.
//
//   DATABASE_URL=... npx tsx scripts/verify-sync-live.ts
//
// (The scratch data lives in the same prod DB but is clearly namespaced and
// deleted at the end; this is the established create-and-clean-up test pattern.)

import { eq } from "drizzle-orm";
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
    const missingDel = await api(`/api/sync/v1/files/${idemId}`, {
      method: "DELETE",
    });
    check("DELETE without If-Match is rejected 428", missingDel.status === 428, `status ${missingDel.status}`);
    const wildcardDel = await api(`/api/sync/v1/files/${idemId}`, {
      method: "DELETE",
      headers: { "If-Match": "*" },
    });
    check("wildcard DELETE is rejected 412", wildcardDel.status === 412, `status ${wildcardDel.status}`);
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

    // ---- 4. Metadata CAS, portable titles, and historical slugs ----
    const metadataCreate = await api("/api/sync/v1/files", {
      method: "POST",
      headers: { "Content-Type": "text/markdown" },
      body: "---\ntype: article\nslug: first-slug\ntitle: Question??\n---\n\nportable title",
    });
    const metadataCreated = await metadataCreate.json();
    const metadataId = metadataCreated?.item?.id;
    if (!metadataId) {
      throw new Error(
        `metadata fixture create failed (${metadataCreate.status}): ${JSON.stringify(metadataCreated)}`,
      );
    }
    const metadataBase = await api(`/api/sync/v1/files/${metadataId}`);
    const metadataBaseHash = metadataBase.headers.get("etag") || "";
    const folderCreate = await api("/api/sync/v1/folders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `folder-${STAMP}`,
      },
      body: JSON.stringify({ parent_path: "blog", name: "Portable??" }),
    });
    const folderCreated = await folderCreate.json();
    const targetFolderId = folderCreated?.folder?.id;
    if (!targetFolderId) {
      throw new Error(
        `folder fixture create failed (${folderCreate.status}): ${JSON.stringify(folderCreated)}`,
      );
    }
    const metadataPatch = await api(`/api/sync/v1/files/${metadataId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": metadataBaseHash,
      },
      body: JSON.stringify({
        folder: targetFolderId,
        slug: "Question??",
        title: "Question??",
      }),
    });
    const metadataPatched = await metadataPatch.json();
    const metadataHash = metadataPatched?.item?.hash || "";
    check(
      "metadata move changes the exact sync-file ETag",
      metadataPatch.status === 200
        && metadataHash.length > 0
        && metadataHash !== metadataBaseHash.replaceAll('"', ""),
      `${metadataBaseHash} -> ${metadataHash}`,
    );
    check(
      "question marks remain in the title while the route slug stays safe",
      metadataPatched?.item?.title === "Question??"
        && metadataPatched?.item?.slug === "question",
      `${metadataPatched?.item?.title} / ${metadataPatched?.item?.slug}`,
    );

    const staleMetadataPatch = await api(`/api/sync/v1/files/${metadataId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": metadataBaseHash,
      },
      body: JSON.stringify({ title: "Stale rename" }),
    });
    check(
      "stale metadata PATCH is rejected 412",
      staleMetadataPatch.status === 412,
      `status ${staleMetadataPatch.status}`,
    );
    const wildcardMetadataPatch = await api(`/api/sync/v1/files/${metadataId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": "*",
      },
      body: JSON.stringify({ title: "Wildcard rename" }),
    });
    check(
      "wildcard metadata PATCH is rejected 412",
      wildcardMetadataPatch.status === 412,
      `status ${wildcardMetadataPatch.status}`,
    );

    const wildcardPut = await api(`/api/sync/v1/files/${metadataId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "text/markdown",
        "If-Match": "*",
      },
      body: "---\ntype: article\nslug: question\ntitle: Question??\nstatus: published\n---\n\nportable title",
    });
    check(
      "wildcard content PUT is rejected 412",
      wildcardPut.status === 412,
      `status ${wildcardPut.status}`,
    );

    // Publish through the same audited sync mutation path used by a real
    // client. The verifier must not create a passing redirect by editing the
    // database behind the API's back.
    const publishBase = await api(`/api/sync/v1/files/${metadataId}`);
    const publishHash = publishBase.headers.get("etag") || "";
    const publish = await api(`/api/sync/v1/files/${metadataId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "text/markdown",
        "If-Match": publishHash,
      },
      body: "---\ntype: article\nslug: question\ntitle: Question??\nstatus: published\n---\n\nportable title",
    });
    check("publishing through audited sync PUT succeeds", publish.status === 200, `status ${publish.status}`);
    const historical = await fetch(`${ORIGIN}/t/${HANDLE}/first-slug`, {
      redirect: "manual",
    });
    check(
      "old visible slug redirects 307 to the canonical safe slug",
      historical.status === 307
        && historical.headers.get("location")?.endsWith(`/t/${HANDLE}/question`) === true,
      `status ${historical.status}, location ${historical.headers.get("location")}`,
    );

    // ---- 5. Durable change cursor advances on a mutation ----
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
