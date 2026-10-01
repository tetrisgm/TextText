import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1";
describe.skipIf(!enabled)("file-vault comment audit against local Postgres", () => {
  let db: NonNullable<typeof import("@/lib/db/client").db>;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let root: string;
  const actorUserId = randomUUID(), workspaceId = randomUUID(), itemId = randomUUID();
  const handle = `vault-comments-${randomUUID()}`;
  const targetId = `${workspaceId}:${itemId}`;

  beforeAll(async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname)) throw new Error("Only local Postgres is allowed");
    const client = await import("@/lib/db/client");
    if (!client.db) throw new Error("Local Postgres is required");
    db = client.db; schema = await import("@/lib/db/schema"); store = await import("@/lib/store");
    root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-vault-comments-db-"));
    await db.insert(schema.users).values({ id: actorUserId, name: "Comment author" });
    await db.insert(schema.blogs).values({ id: workspaceId, handle, name: "Comment fixture", ownerId: actorUserId });
    const document = emptyDocumentSnapshot(); document.content.body = "The document remains in its pack";
    const bytes = buildTextpack("Comment fixture", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\n${document.content.body}` });
    const directory = await import("./server-store");
    await directory.writeVaultTextpack({ root, workspaceId, itemId, operationId: "seed",
      relativePath: "Note.textpack", baseRevision: null, bytes });
  });
  afterAll(async () => {
    if (db) {
      await db.delete(schema.actionAudit).where(eq(schema.actionAudit.targetId, targetId));
      await db.delete(schema.blogs).where(eq(schema.blogs.id, workspaceId));
      await db.delete(schema.users).where(eq(schema.users.id, actorUserId));
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("records one action per durable TextPack comment, without copying its body into the database", async () => {
    const operationId = randomUUID();
    const input = { root, workspaceId, itemId, operationId,
      actor: { userId: actorUserId, name: "Comment author", type: "human" as const },
      mutation: { kind: "create" as const, body: "Private discussion body" } };
    expect((await store.mutateVaultItemComments(input)).status).toBe("written");
    expect((await store.mutateVaultItemComments(input)).status).toBe("written");
    const resolved = await store.mutateVaultItemComments({ ...input, operationId: randomUUID(),
      mutation: { kind: "resolve", commentId: operationId, resolved: true } });
    expect(resolved.status).toBe("written");
    const page = await store.listVaultItemComments({ root, workspaceId, itemId });
    expect(page?.comments).toMatchObject([{ id: operationId, body: "Private discussion body" }]);
    expect(page?.comments[0].resolvedAt).not.toBeNull();
    const rows = await db.select({ actionName: schema.actionAudit.actionName,
      inputSummary: schema.actionAudit.inputSummary,
      outputSummary: schema.actionAudit.outputSummary }).from(schema.actionAudit)
      .where(eq(schema.actionAudit.targetId, targetId));
    expect(rows.map(row => row.actionName).sort()).toEqual(["vault.comment.create", "vault.comment.resolve"]);
    expect(JSON.stringify(rows)).not.toContain("Private discussion body");
  });
});
