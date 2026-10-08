import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1";
describe.skipIf(!enabled)("legacy reconciliation inventory against local Postgres", () => {
  let db: NonNullable<typeof import("@/lib/db/client").db>;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  const owner = randomUUID(), workspace = randomUUID(), parent = randomUUID(), child = randomUUID();
  const post = randomUUID(), missing = randomUUID(), comment = randomUUID(), grant = randomUUID();
  const document = emptyDocumentSnapshot();
  document.content.title = "Isolated inventory fixture";
  document.content.body = "Preserve this source exactly.";
  document.content.assets = [{ id: "unchecked-image", kind: "image", src: "https://example.test/private.png" }];
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    const client = await import("@/lib/db/client");
    if (!client.db) throw new Error("Local Postgres is required");
    db = client.db; schema = await import("@/lib/db/schema"); store = await import("@/lib/store");
    await db.insert(schema.users).values({ id: owner, name: "Inventory fixture owner" });
    await db.insert(schema.blogs).values({ id: workspace, ownerId: owner, handle: `inventory-${randomUUID()}`, name: "Inventory fixture" });
    await db.insert(schema.folders).values([{ id: parent, blogId: workspace, name: "Parent", path: "parent" }, { id: child, blogId: workspace, parentId: parent, name: "Child", path: "parent/child" }]);
    await db.insert(schema.posts).values([
      { id: post, blogId: workspace, folderId: child, slug: "existing", slugHistory: ["previous"], title: document.content.title, body: document.content.body, document },
      { id: missing, blogId: workspace, folderId: child, slug: "missing", title: "Missing from vault", document, deletedAt: new Date() },
    ]);
    await db.insert(schema.itemComments).values({ id: comment, postId: post, authorUserId: owner, authorName: "Fixture", authorActorType: "human", body: "Keep discussion" });
    // Pending email invitation on an ancestor, with no accepted userId.
    await db.insert(schema.collaborators).values({ id: grant, scopeType: "folder", scopeId: parent, invitedEmail: `inventory-${randomUUID()}@example.test`, role: "viewer", invitedById: owner });
  });
  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.collaborators).where(eq(schema.collaborators.id, grant));
    await db.delete(schema.itemComments).where(eq(schema.itemComments.id, comment));
    await db.delete(schema.posts).where(inArray(schema.posts.id, [post, missing]));
    await db.delete(schema.folders).where(inArray(schema.folders.id, [child, parent]));
    await db.delete(schema.blogs).where(eq(schema.blogs.id, workspace));
    await db.delete(schema.users).where(eq(schema.users.id, owner));
  });
  async function capture() {
    return {
      posts: await db.select().from(schema.posts).where(eq(schema.posts.blogId, workspace)),
      folders: await db.select().from(schema.folders).where(eq(schema.folders.blogId, workspace)),
      workspace: await db.select().from(schema.blogs).where(eq(schema.blogs.id, workspace)),
      comments: await db.select().from(schema.itemComments).where(eq(schema.itemComments.postId, post)),
      grants: await db.select().from(schema.collaborators).where(eq(schema.collaborators.id, grant)),
      audit: await db.select().from(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, owner)),
    };
  }
  it("executes correlated SQL, preserves revisions and finds pending inherited access without mutations", async () => {
    const before = await capture();
    const result = await store.readLegacyWorkspaceInventory({ workspaceId: workspace, vault: [{ itemId: post, relativePath: "Parent/Child/Existing.textpack", revision: "vault-independent", contentDigest: store.legacyInventoryDigest(document) }] });
    const match = result.items.find((item) => item.id === post)!;
    expect(match.status).toBe("matching");
    expect(match.sources[0].revision).toBe(before.posts.find((item) => item.id === post)!.revision);
    expect(match.sources[0].slugHistory).toEqual(["previous"]);
    expect(match.sources[0].comments).toBe(1);
    expect(match.sources[0].grants).toBe(1);
    expect(match.blockers).toEqual(["asset-not-inspected:unchecked-image", "comments-require-migration", "grants-require-migration"]);
    expect(result.items.find((item) => item.id === missing)).toMatchObject({ status: "missing", sources: [{ deleted: true }] });
    expect(await capture()).toEqual(before);
    const unrelated = await store.readLegacyWorkspaceInventory({ workspaceId: randomUUID(), vault: [] });
    expect(unrelated.items).toEqual([]);
  });
});
