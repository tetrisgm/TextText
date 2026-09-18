import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

/**
 * The checker, checked.
 *
 * A consistency checker nobody has seen fail is not a checker, it is a
 * function that returns "fine". Each test here breaks one thing deliberately,
 * in the database and behind the store's back, and asserts that the report
 * names it. Then it puts it back and asserts the report is clean, so a check
 * that is simply always red cannot pass either.
 */

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("the sync consistency checker", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let check: typeof import("@/lib/sync-consistency").checkWorkspaceConsistency;
  let userId = "";
  let blogId = "";
  let handle = "";
  let folderId = "";
  let postId = "";

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    ({ db } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    ({ checkWorkspaceConsistency: check } = await import("@/lib/sync-consistency"));
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `consistency-${stamp}`;
    const [created] = await db
      .insert(schema.users)
      .values({ appleSub: handle, username: handle, email: `${handle}@example.invalid`, name: "Consistency" })
      .returning({ id: schema.users.id });
    userId = created.id;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "Consistency", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);
    folderId = (await store.getFolders(handle)).find((folder) => folder.mode === "notes")!.id;
    const item = await store.createDraftInFolder(handle, folderId, {
      initial: { type: "note", title: "consistent", body: "what the document says" },
    });
    postId = item.id!;
  });

  afterAll(async () => {
    if (!db || !blogId) return;
    await db.delete(schema.collabUpdates).where(eq(schema.collabUpdates.postId, postId));
    await db.delete(schema.collabState).where(eq(schema.collabState.postId, postId));
    await db.delete(schema.postRevisions).where(eq(schema.postRevisions.blogId, blogId));
    await db.delete(schema.feedReceipts).where(eq(schema.feedReceipts.blogId, blogId));
    await db.delete(schema.feedConnections).where(eq(schema.feedConnections.blogId, blogId));
    await db.delete(schema.posts).where(eq(schema.posts.blogId, blogId));
    await db.delete(schema.folders).where(eq(schema.folders.blogId, blogId));
    await db.delete(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    await db.delete(schema.blogs).where(eq(schema.blogs.id, blogId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  const named = async (fragment: string) => {
    const report = await check(blogId);
    return report.findings.find((finding) => finding.check.includes(fragment));
  };

  it("SC-01: a workspace the store built is consistent", async () => {
    const report = await check(blogId);
    expect(report.findings, JSON.stringify(report.findings)).toEqual([]);
    expect(report.consistent).toBe(true);
    expect(report.items).toBeGreaterThan(0);
  });

  it("SC-02: a column that stops agreeing with its document is named", async () => {
    await db!.update(schema.posts).set({ title: "what the column says instead" }).where(eq(schema.posts.id, postId));
    const finding = await named("the columns say what the document says");
    expect(finding, "drift between a column and its document went unreported").toBeTruthy();
    expect(finding!.examples).toContain(postId);
    // Put it back the way the store would have written it.
    await db!.update(schema.posts).set({ title: "consistent" }).where(eq(schema.posts.id, postId));
    expect(await named("the columns say what the document says")).toBeUndefined();
  });

  it("SC-03: an unreadable document cannot be stored at all", async () => {
    // The checker looks for one anyway, because a constraint can be dropped
    // and a workspace can arrive from somewhere else. But the reason it never
    // finds one is better than the check: posts_document_schema_v1_valid
    // refuses the row, so the state cannot exist.
    // The driver wraps the constraint name in a cause, so look for it there.
    let refusedBy = "";
    try {
      await db!.execute(
        sql`UPDATE ${schema.posts} SET document = '{"nothing":"that is a document"}'::jsonb WHERE id = ${postId}::uuid`,
      );
    } catch (error) {
      refusedBy = JSON.stringify({
        message: (error as Error).message,
        constraint: ((error as { cause?: { constraint?: string } }).cause ?? {}).constraint,
      });
    }
    expect(refusedBy, "the database accepted a document that is not one").toContain("posts_document_schema_v1_valid");
    expect(await named("every item's document can be read")).toBeUndefined();
  });

  it("SC-04: a collaborative marker ahead of its item is named", async () => {
    const [row] = await db!.select({ revision: schema.posts.revision }).from(schema.posts).where(eq(schema.posts.id, postId));
    await db!
      .insert(schema.collabState)
      .values({ postId, epoch: 1, materializedRevision: Number(row.revision) + 5 })
      .onConflictDoUpdate({ target: schema.collabState.postId, set: { materializedRevision: Number(row.revision) + 5 } });
    const finding = await named("no collaborative marker is ahead of its item");
    expect(finding, "a marker claiming a revision the item never reached went unreported").toBeTruthy();
    expect(finding!.examples).toContain(postId);
    await db!.update(schema.collabState).set({ materializedRevision: Number(row.revision) }).where(eq(schema.collabState.postId, postId));
    expect(await named("no collaborative marker is ahead of its item")).toBeUndefined();
  });

  it("SC-05: a retired collaborative log left behind is named", async () => {
    await db!.update(schema.collabState).set({ epoch: 4 }).where(eq(schema.collabState.postId, postId));
    await db!.insert(schema.collabUpdates).values({ postId, epoch: 2, seq: 1, update: "AAAA" });
    const finding = await named("no retired collaborative log is left behind");
    expect(finding, "a log below the current epoch went unreported").toBeTruthy();
    expect(finding!.examples.join(" ")).toContain(postId);
    await db!.delete(schema.collabUpdates).where(eq(schema.collabUpdates.postId, postId));
    expect(await named("no retired collaborative log is left behind")).toBeUndefined();
  });

  it("SC-06: an active receipt whose item is gone is named", async () => {
    const [folder] = await db!
      .insert(schema.folders)
      .values({ blogId, name: "feed", path: "bookmarks/feed", mode: "bookmarks" })
      .returning({ id: schema.folders.id });
    const [connection] = await db!
      .insert(schema.feedConnections)
      .values({ blogId, folderId: folder.id, endpointUrl: "https://example.invalid/feed", endpointKey: `k-${Date.now()}` })
      .returning({ id: schema.feedConnections.id });
    const [receipt] = await db!
      .insert(schema.feedReceipts)
      .values({ connectionId: connection.id, blogId, externalKey: "gone", postId: null, contentHash: "abc", status: "active" })
      .returning({ id: schema.feedReceipts.id });
    const finding = await named("no active receipt has lost its item");
    expect(finding, "a receipt whose item was destroyed went unreported").toBeTruthy();
    expect(finding!.examples).toContain(receipt.id);
    // The tombstone the delete should have written.
    await db!.update(schema.feedReceipts).set({ status: "expired", expiredAt: new Date() }).where(eq(schema.feedReceipts.id, receipt.id));
    expect(await named("no active receipt has lost its item")).toBeUndefined();
  });

  it("SC-07: and the workspace is consistent again at the end", async () => {
    const report = await check(blogId);
    expect(report.findings, JSON.stringify(report.findings)).toEqual([]);
  });
});
