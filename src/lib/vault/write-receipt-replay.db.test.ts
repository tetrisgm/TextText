import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1";
describe.skipIf(!enabled)("file receipt replay through the production PostgreSQL audit sink", () => {
  let db: NonNullable<typeof import("@/lib/db/client").db>;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let root: string;
  const actorUserId = randomUUID(), workspaceId = randomUUID(), itemId = randomUUID(), operationId = randomUUID();
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    const client = await import("@/lib/db/client");
    if (!client.db) throw new Error("Local Postgres is required");
    db = client.db; schema = await import("@/lib/db/schema"); store = await import("@/lib/store");
    root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-receipt-replay-db-"));
    await db.insert(schema.users).values({ id: actorUserId, name: "Receipt fixture" });
    await db.insert(schema.blogs).values({ id: workspaceId, handle: `receipt-${workspaceId}`, name: "Receipt fixture", ownerId: actorUserId });
  });
  afterAll(async () => {
    if (db) {
      await db.delete(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, actorUserId));
      await db.delete(schema.blogs).where(eq(schema.blogs.id, workspaceId));
      await db.delete(schema.users).where(eq(schema.users.id, actorUserId));
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it("drains an interrupted audit outbox and applies a lost-ACK replay exactly once", async () => {
    const document = emptyDocumentSnapshot(); document.content.body = "Receipt body stays in the file";
    const bytes = buildTextpack("Receipt fixture", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\n${document.content.body}` });
    const request = { root, workspaceId, itemId, operationId, relativePath: "Notes/Receipt.textpack", baseRevision: null, bytes };
    const directory = await import("./server-store");
    await expect(directory.writeVaultTextpack({ ...request, audit: { actorUserId, actorType: "human" },
      onReceipt: async () => { throw new Error("Fixture audit unavailable after file commit"); },
    })).rejects.toThrow("Fixture audit unavailable");
    expect(await db.select().from(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, actorUserId))).toHaveLength(0);
    const reopened = await store.readVaultTextpack({ root, workspaceId, itemId });
    expect(reopened?.bytes).toEqual(Buffer.from(bytes));
    const revision = createHash("sha256").update(bytes).digest("hex");
    expect(await store.writeVaultTextpack({ ...request, actorUserId, actorType: "human" })).toMatchObject({ status: "written", revision });
    const rows = await db.select().from(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, actorUserId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actionName: "vault.write", targetId: itemId, inputSummary: `operation ${operationId}` });
    expect(JSON.stringify(rows)).not.toContain(document.content.body);
    await expect(store.writeVaultTextpack({ ...request, bytes: buildTextpack("Changed", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\nChanged` }), actorUserId, actorType: "human" })).rejects.toThrow("reused");
    expect(await db.select().from(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, actorUserId))).toHaveLength(1);
  });
});
