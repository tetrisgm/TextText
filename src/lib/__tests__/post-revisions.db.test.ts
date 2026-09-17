import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";

// Against local Postgres only (npm run test:reading:db). Proves the one rule
// the history exists for: nothing replaces a document's text without writing
// that text down in the same statement.
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("document history against Postgres", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let revisions: typeof import("@/lib/revisions");
  let userId = "";
  let blogId = "";
  let handle = "";
  let postId = "";
  let folderId = "";

  const longBody = ["I truly think this is the best episode of the season.", "", "The bridge scene works because it earns the silence.", "", "Three more lines so the shrink is unmistakable."].join("\n");

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    ({ db } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    revisions = await import("@/lib/revisions");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `history-test-${stamp}`;
    const [created] = await db.insert(schema.users).values({ appleSub: handle, username: handle, email: `${handle}@example.invalid`, name: "History Test" }).returning({ id: schema.users.id });
    userId = created.id;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "History Test", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);
    const folders = await store.getFolders(handle);
    folderId = folders.find((folder) => folder.mode === "notes")!.id;
  });

  afterAll(async () => {
    if (!db || !blogId) return;
    await db.delete(schema.postRevisions).where(eq(schema.postRevisions.blogId, blogId));
    await db.delete(schema.posts).where(eq(schema.posts.blogId, blogId));
    await db.delete(schema.folders).where(eq(schema.folders.blogId, blogId));
    await db.delete(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    await db.delete(schema.blogs).where(eq(schema.blogs.id, blogId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  async function history() {
    return db!.select().from(schema.postRevisions).where(eq(schema.postRevisions.postId, postId)).orderBy(desc(schema.postRevisions.createdAt));
  }

  it("HIS-01: a truncating write records the text it replaced, with the shrink measured", async () => {
    const created = await store.createDraftInFolder(handle, folderId, { initial: { type: "note", title: "snw ep9", body: longBody } });
    postId = created.id!;
    expect(await history()).toHaveLength(0);
    // The exact shape of the incident: a writer replaces the body with its
    // first two words.
    const before = (await store.getPostById(handle, postId))!;
    await store.savePost(handle, { ...before, document: { ...before.document!, content: { ...before.document!.content, body: "I truly\n" } } });
    const rows = await history();
    expect(rows).toHaveLength(1);
    expect(rows[0].document.content.body).toBe(longBody);
    expect(rows[0].bodyLength).toBe(longBody.length);
    expect(rows[0].shrankBy).toBe(longBody.length - "I truly\n".length);
    expect(rows[0].supersededByAction).toBe("save_document");
    expect(rows[0].revision).toBe(before.revision);
  });

  it("HIS-02: the replaced text is restorable, and restoring is itself recorded", async () => {
    const [lost] = await history();
    const summaries = await revisions.listPostRevisions(postId);
    expect(summaries[0].id).toBe(lost.id);
    expect(summaries[0].preview).toContain("I truly think this is the best episode");
    const version = await revisions.getPostRevision(postId, lost.id);
    expect(version).toBeTruthy();
    const current = (await store.getPostById(handle, postId))!;
    await store.savePost(
      handle,
      { ...current, document: version!.document },
      { audit: { actorUserId: userId, actorType: "human", actionName: "restore_revision", targetType: "item", targetId: postId, inputSummary: lost.id } },
    );
    expect((await store.getPostById(handle, postId))!.body).toBe(longBody);
    const rows = await history();
    expect(rows).toHaveLength(2);
    expect(rows[0].supersededByAction).toBe("restore_revision");
    expect(rows[0].document.content.body).toBe("I truly\n");
  });

  it("HIS-03: ordinary keystroke saves coalesce, but a different writer and any shrink always record", async () => {
    const before = await history();
    const current = (await store.getPostById(handle, postId))!;
    // Three growing saves by the same writer inside the window: one row at most.
    let latest = current;
    for (const suffix of ["a", "ab", "abc"]) {
      latest = await store.savePost(handle, { ...latest, document: { ...latest.document!, content: { ...latest.document!.content, body: `${longBody}${suffix}` } } });
    }
    expect((await history()).length).toBe(before.length);
    // A different kind of actor is never coalesced away.
    await store.savePost(
      handle,
      { ...latest, document: { ...latest.document!, content: { ...latest.document!.content, body: `${longBody}abcd` } } },
      { audit: { actorUserId: null, actorType: "external_agent", actionName: "sync.put_file", targetType: "item", targetId: postId } },
    );
    const afterAgent = await history();
    expect(afterAgent.length).toBe(before.length + 1);
    expect(afterAgent[0].supersededByAction).toBe("sync.put_file");
    // And any shrink records, even seconds after the last row.
    const now = (await store.getPostById(handle, postId))!;
    await store.savePost(handle, { ...now, document: { ...now.document!, content: { ...now.document!.content, body: "gone" } } });
    const afterShrink = await history();
    expect(afterShrink.length).toBe(afterAgent.length + 1);
    expect(afterShrink[0].shrankBy).toBeGreaterThan(0);
    expect(afterShrink[0].document.content.body).toContain("best episode of the season");
  });

  it("HIS-04: a guarded save that loses its race records nothing", async () => {
    const before = await history();
    const current = (await store.getPostById(handle, postId))!;
    await expect(
      store.savePost(handle, { ...current, document: { ...current.document!, content: { ...current.document!.content, body: "stale writer" } } }, { expectedRevision: (current.revision ?? 0) - 5 }),
    ).rejects.toThrow();
    expect((await history()).length).toBe(before.length);
    expect((await store.getPostById(handle, postId))!.body).toBe("gone");
  });
});
