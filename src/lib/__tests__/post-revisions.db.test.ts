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
  let bookmarksFolderId = "";

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
    bookmarksFolderId = folders.find((folder) => folder.mode === "bookmarks")!.id;
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

  it("HIS-05: a replacement of the same length is never coalesced away", async () => {
    // The window used to key on a net shrink, so a select-all-paste of an
    // equally long or longer document left no copy of what it replaced.
    const created = await store.createDraftInFolder(handle, folderId, { initial: { type: "note", title: "replacement", body: "A".repeat(400) } });
    const replaced = created.id!;
    const first = (await store.getPostById(handle, replaced))!;
    await store.savePost(handle, { ...first, document: { ...first.document!, content: { ...first.document!.content, body: "B".repeat(400) } } });
    const second = (await store.getPostById(handle, replaced))!;
    await store.savePost(handle, { ...second, document: { ...second.document!, content: { ...second.document!.content, body: `${"C".repeat(400)} and longer` } } });
    const rows = await db!.select().from(schema.postRevisions).where(eq(schema.postRevisions.postId, replaced)).orderBy(desc(schema.postRevisions.createdAt));
    expect(rows.map((row) => row.document.content.body)).toEqual([
      "B".repeat(400),
      "A".repeat(400),
    ]);
  });

  it("HIS-06: a rename records the title it replaced", async () => {
    const created = await store.createDraftInFolder(handle, folderId, { initial: { type: "note", title: "Before the rename", body: "The body is untouched." } });
    const renamed = created.id!;
    const moved = await store.movePostFile(handle, renamed, { title: "After the rename" });
    expect(moved?.post.title).toBe("After the rename");
    const rows = await db!.select().from(schema.postRevisions).where(eq(schema.postRevisions.postId, renamed));
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Before the rename");
    expect(rows[0].document.content.body).toBe("The body is untouched.");
  });

  it("HIS-07: a recapture that replaces the body records the owner's own words", async () => {
    const created = await store.createDraftInFolder(handle, bookmarksFolderId, {
      initial: { type: "bookmark", title: "example.com", body: "", links: [{ href: "https://example.invalid/article", label: "Source" }] },
    });
    const bookmark = created.id!;
    const asset = { originalUrl: "https://example.invalid/hero.png", url: "/blob/hero.png" };
    await store.saveBookmarkCapture(handle, bookmark, {
      url: "https://example.invalid/article", title: "The article", assets: [asset],
    }, { readableMarkdown: "![hero](https://example.invalid/hero.png)\n\nThe captured article text." });
    const captured = (await store.getPostById(handle, bookmark))!;
    // The owner writes around the capture, which is the state a recapture used
    // to destroy without a trace.
    const annotated = `My own note about this.\n\n${captured.body}`;
    await store.savePost(handle, { ...captured, document: { ...captured.document!, content: { ...captured.document!.content, body: annotated } } });
    const beforeRecapture = await db!.select().from(schema.postRevisions).where(eq(schema.postRevisions.postId, bookmark));
    await store.saveBookmarkCapture(handle, bookmark, {
      url: "https://example.invalid/article", title: "The article", assets: [asset],
    }, { readableMarkdown: "A completely different and rather longer extraction of the page, with more words in it.", replaceCapture: true });
    const after = (await store.getPostById(handle, bookmark))!;
    expect(after.body).not.toContain("My own note about this.");
    const rows = await db!.select().from(schema.postRevisions).where(eq(schema.postRevisions.postId, bookmark)).orderBy(desc(schema.postRevisions.createdAt));
    expect(rows.length).toBe(beforeRecapture.length + 1);
    expect(rows[0].document.content.body).toContain("My own note about this.");
    expect(rows[0].supersededByAction).toBe("capture_replaced_body");
  });

  it("HIS-08: a long session of deletions still keeps the full document", async () => {
    const original = "S".repeat(4000);
    const created = await store.createDraftInFolder(handle, folderId, { initial: { type: "note", title: "long session", body: original } });
    const trimmed = created.id!;
    let current = (await store.getPostById(handle, trimmed))!;
    // Each save deletes a little, which forces a row every time. Retention must
    // not evict the one version that still holds everything.
    for (let index = 0; index < 220; index += 1) {
      const body = original.slice(0, original.length - (index + 1) * 10);
      current = await store.savePost(handle, { ...current, document: { ...current.document!, content: { ...current.document!.content, body } } });
    }
    const rows = await db!.select().from(schema.postRevisions).where(eq(schema.postRevisions.postId, trimmed));
    expect(rows.length).toBeLessThanOrEqual(210);
    expect(rows.some((row) => row.document.content.body === original)).toBe(true);
  });

  it("HIS-09: two rotations racing the same session record one version", async () => {
    const created = await store.createDraftInFolder(handle, folderId, { initial: { type: "note", title: "rotate once", body: "canonical" } });
    const rotated = created.id!;
    const previous = {
      blogId,
      revision: 1,
      document: { ...created.document!, content: { ...created.document!.content, body: "text only the session had" } },
      title: "rotate once",
      body: "text only the session had",
    };
    const first = await revisions.recordSupersededVersion({ postId: rotated, previous, nextBody: "canonical", writer: { action: "collab.rotate", actorType: "system", actorUserId: null } });
    const second = await revisions.recordSupersededVersion({ postId: rotated, previous, nextBody: "canonical", writer: { action: "collab.rotate", actorType: "system", actorUserId: null } });
    expect(first).toBe(true);
    expect(second).toBe(false);
    const rows = await db!.select().from(schema.postRevisions).where(eq(schema.postRevisions.postId, rotated));
    expect(rows).toHaveLength(1);
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
