import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import { documentText } from "@/lib/collab/document";

/**
 * What a baseline rotation is allowed to throw away.
 *
 * A rotation adopts the canonical document and sweeps the editing session that
 * produced the log. Anything that session holds and the canonical document
 * does not exists nowhere else at that moment, so it has to reach the history
 * first. These run against local Postgres only (npm run test:db).
 */
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("baseline rotation against Postgres", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let collab: typeof import("@/lib/collab");
  let userId = "";
  let blogId = "";
  let handle = "";
  let folderId = "";

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    ({ db } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    collab = await import("@/lib/collab");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `rotation-test-${stamp}`;
    const [created] = await db.insert(schema.users).values({ appleSub: handle, username: handle, email: `${handle}@example.invalid`, name: "Rotation Test" }).returning({ id: schema.users.id });
    userId = created.id;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "Rotation Test", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);
    folderId = (await store.getFolders(handle)).find((folder) => folder.mode === "notes")!.id;
  });

  afterAll(async () => {
    if (!db || !blogId) return;
    const items = await db.select({ id: schema.posts.id }).from(schema.posts).where(eq(schema.posts.blogId, blogId));
    for (const item of items) {
      await db.delete(schema.collabUpdates).where(eq(schema.collabUpdates.postId, item.id));
      await db.delete(schema.collabState).where(eq(schema.collabState.postId, item.id));
      await db.delete(schema.actionAudit).where(eq(schema.actionAudit.targetId, item.id));
    }
    await db.delete(schema.postRevisions).where(eq(schema.postRevisions.blogId, blogId));
    await db.delete(schema.posts).where(eq(schema.posts.blogId, blogId));
    await db.delete(schema.folders).where(eq(schema.folders.blogId, blogId));
    await db.delete(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    await db.delete(schema.blogs).where(eq(schema.blogs.id, blogId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  /** One editing session: catch up, edit the shared document, push the update. */
  async function session(postId: string, edit: (doc: Y.Doc) => void) {
    const baseline = await collab.prepareCollabBaseline(postId);
    if (!baseline) throw new Error("no baseline");
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, Buffer.from(baseline.update, "base64"));
      const before = Y.encodeStateVector(doc);
      edit(doc);
      const update = Buffer.from(Y.encodeStateAsUpdate(doc, before)).toString("base64");
      const result = await collab.appendCollabUpdate(postId, update, baseline.epoch);
      expect(result).not.toHaveProperty("retired");
      return baseline;
    } finally {
      doc.destroy();
    }
  }

  async function versions(postId: string) {
    return db!.select().from(schema.postRevisions).where(eq(schema.postRevisions.postId, postId));
  }

  it("ROT-01: a session that only renamed the item is kept, not swept", async () => {
    const created = await store.createDraftInFolder(handle, folderId, { initial: { type: "note", title: "Before", body: "The body both sides share." } });
    const postId = created.id!;
    const baseline = await session(postId, (doc) => {
      const title = documentText(doc, "title");
      title.delete(0, title.length);
      title.insert(0, "The name only the session had");
    });

    // An out-of-band write bumps the canonical revision without touching the
    // body, which is what arms the rotation on the next open.
    const current = (await store.getPostById(handle, postId))!;
    await store.savePost(handle, { ...current, pinned: true });
    await collab.prepareCollabBaseline(postId);

    const rows = await versions(postId);
    const rotated = rows.filter((row) => row.supersededByAction === "collab.rotate");
    expect(rotated).toHaveLength(1);
    expect(rotated[0].supersededByActorType).toBe("system");
    expect(rotated[0].document.content.title).toBe("The name only the session had");
    // The rotation is a mutation, so it leaves an audit row of its own.
    const audit = await db!.select().from(schema.actionAudit).where(and(eq(schema.actionAudit.targetId, postId), eq(schema.actionAudit.actionName, "collab.rotate")));
    expect(audit).toHaveLength(1);
    // And the retired log really is gone, which is why the copy had to exist.
    const remaining = await db!.select().from(schema.collabUpdates).where(and(eq(schema.collabUpdates.postId, postId), eq(schema.collabUpdates.epoch, baseline.epoch)));
    expect(remaining).toHaveLength(0);
  });

  it("ROT-02: a session the canonical document already contains records nothing", async () => {
    const created = await store.createDraftInFolder(handle, folderId, { initial: { type: "note", title: "Contained", body: "Shared opening." } });
    const postId = created.id!;
    await session(postId, (doc) => {
      const body = documentText(doc, "body");
      body.insert(body.length, " Session words.");
    });
    // The canonical document is given everything the session had, and more.
    const current = (await store.getPostById(handle, postId))!;
    await store.savePost(handle, {
      ...current,
      document: { ...current.document!, content: { ...current.document!.content, body: "Shared opening. Session words. And the canonical tail." } },
    });
    const beforeRotation = await versions(postId);
    await collab.prepareCollabBaseline(postId);
    const afterRotation = await versions(postId);
    expect(afterRotation.length).toBe(beforeRotation.length);
    expect(afterRotation.some((row) => row.supersededByAction === "collab.rotate")).toBe(false);
  });
});
