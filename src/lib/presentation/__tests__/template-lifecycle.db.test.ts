import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { compileItemTypeBlueprint } from "../item-type-blueprint";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { parseSyncDocumentEnvelope, renderSyncDocumentEnvelope, serializeSyncDocumentEnvelope } from "@/lib/documents/sync";

describe.skipIf(process.env.TEXTTEXT_READING_DB_TEST !== "1")("custom type lifecycle in storage", () => {
  let db: NonNullable<typeof import("@/lib/db/client")["db"]>;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let userId = "";
  const userIds: string[] = [];
  const workspaces: { id: string; handle: string }[] = [];
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Local Postgres only");
    const client = await import("@/lib/db/client");
    if (!client.db) throw new Error("Missing database");
    db = client.db;
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    const key = `type-lifecycle-${crypto.randomUUID().slice(0, 8)}`;
    for (const suffix of ["source", "destination"]) {
      const handle = `${key}-${suffix}`;
      const [user] = await db.insert(schema.users).values({ appleSub: handle, username: handle, name: "Type lifecycle fixture" }).returning({ id: schema.users.id });
      userIds.push(user.id);
      if (!userId) userId = user.id;
      const [blog] = await db.insert(schema.blogs).values({ handle, name: key, ownerId: user.id }).returning({ id: schema.blogs.id });
      workspaces.push({ id: blog.id, handle });
      await store.ensureWorkspaceFolders(blog.id);
    }
  });
  afterAll(async () => {
    if (!db || !workspaces.length) return;
    const ids = workspaces.map((entry) => entry.id);
    await db.delete(schema.posts).where(inArray(schema.posts.blogId, ids));
    await db.delete(schema.folders).where(inArray(schema.folders.blogId, ids));
    await db.delete(schema.documentTemplates).where(inArray(schema.documentTemplates.blogId, ids));
    await db.delete(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    await db.delete(schema.blogs).where(inArray(schema.blogs.id, ids));
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  });

  it("preserves pinned items through updates, retirement and a cross-workspace textpack import", async () => {
    const [source, destination] = workspaces;
    const actor = { actorUserId: userId, actorType: "human" as const, actionName: "test.template.lifecycle", targetType: "workspace" as const };
    const definition = compileItemTypeBlueprint({ starter: { title: "Review", body: "## Reading notes", fields: { rating: 3 } }, name: "Book review", description: "Reading notes", fields: [{ id: "author", label: "Author", type: "text" }, { id: "rating", label: "Rating", type: "number" }], item: { shape: "page" }, collection: { layout: "cards" }, theme: { typography: "editorial" } }, { id: "custom.book-review" });
    const v1 = await store.createDocumentTemplateVersion({ blogId: source.id, definition, actor });
    const folder = (await store.getFolders(source.handle)).find((entry) => entry.path === "notes")!;
    const reference = { id: v1.id, version: v1.version };
    const started = await store.createDraftInFolder(source.handle, folder.id, { template: reference });
    expect(started.document?.content).toMatchObject({ title: "Review", body: "## Reading notes", fields: { rating: 3 } });
    const direct = await store.createDraft(source.handle, "note", { template: reference });
    expect(direct.body).toBe("## Reading notes");
    expect(direct.document?.content.fields.rating).toBe(3);
    const explicit = await store.createDraftInFolder(source.handle, folder.id, { template: reference, initial: { title: "My review", body: "Already typed" } });
    expect(explicit).toMatchObject({ title: "My review", body: "Already typed" });
    const document = emptyDocumentSnapshot({ id: v1.id, version: v1.version });
    document.content = { ...document.content, title: "A book worth keeping", body: "A durable review.", fields: { author: "Ursula Le Guin", rating: 5 } };
    const original = await store.createDraftInFolder(source.handle, folder.id, { document, template: document.presentation.template, audit: { ...actor, targetType: "item" } });
    const v2 = await store.createDocumentTemplateVersion({ blogId: source.id, definition: { ...v1, name: "Book review revised" }, expectedNextVersion: 2, actor });
    expect(v2.version).toBe(2);
    await store.retireDocumentTemplate(source.id, v1.id, { audit: actor });
    expect((await store.listDocumentTemplates(source.id)).some((entry) => entry.id === v1.id)).toBe(false);
    expect(await store.getPinnedDocumentTemplates(source.id, [document.presentation.template])).toEqual([v1]);
    expect(await store.getPinnedDocumentTemplates(destination.id, [document.presentation.template])).toEqual([]);
    const reopened = await store.getPostById(source.handle, original.id!);
    expect(reopened?.document).toEqual(document);
    expect(await store.getDocumentTemplate(source.id, document.presentation.template)).toEqual(v1);
    const parsed = parseSyncDocumentEnvelope(serializeSyncDocumentEnvelope(renderSyncDocumentEnvelope({ markdown: document.content.body, post: reopened!, template: v1 })));
    expect(await store.installDocumentTemplate({ blogId: destination.id, definition: parsed.template! })).toBe("installed");
    const targetFolder = (await store.getFolders(destination.handle)).find((entry) => entry.path === "notes")!;
    const imported = await store.createDraftInFolder(destination.handle, targetFolder.id, { document: parsed.document, template: parsed.document.presentation.template, audit: { ...actor, targetType: "item" } });
    expect((await store.getPostById(destination.handle, imported.id!))?.document).toEqual(document);
    expect(await store.getDocumentTemplate(destination.id, parsed.document.presentation.template)).toEqual(v1);
    expect(await store.installDocumentTemplate({ blogId: source.id, definition: { ...v1, version: 3 } })).toBe("installed");
    expect((await store.listDocumentTemplates(source.id)).some((entry) => entry.id === v1.id)).toBe(false);
  });
});
