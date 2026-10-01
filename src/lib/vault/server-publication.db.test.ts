import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1";
describe.skipIf(!enabled)("file-vault publication audit against local Postgres", () => {
  let db: NonNullable<typeof import("@/lib/db/client").db>;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let root: string;
  let previousRoot: string | undefined;
  const actorUserId = randomUUID(), workspaceId = randomUUID(), itemId = randomUUID();
  const targetId = `${workspaceId}:${itemId}`;

  beforeAll(async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname)) throw new Error("Only local Postgres is allowed");
    const client = await import("@/lib/db/client");
    if (!client.db) throw new Error("Local Postgres is required");
    db = client.db; schema = await import("@/lib/db/schema"); store = await import("@/lib/store");
    root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-vault-publication-db-"));
    previousRoot = process.env.TEXTTEXT_VAULT_ROOT;
    process.env.TEXTTEXT_VAULT_ROOT = root;
    await db.insert(schema.users).values({ id: actorUserId, name: "Publication owner" });
    await db.insert(schema.blogs).values({ id: workspaceId, handle: `vault-publish-${randomUUID()}`,
      name: "Publication fixture", ownerId: actorUserId });
    const document = emptyDocumentSnapshot(); document.content.title = "Public title"; document.content.body = "Saved content";
    const bytes = buildTextpack("Publication fixture", { document,
      markdown: `---\ntextTextId: ${itemId}\n---\n\n${document.content.body}` });
    const directory = await import("./server-store");
    await directory.writeVaultTextpack({ root, workspaceId, itemId, operationId: "seed",
      relativePath: "Note.textpack", baseRevision: null, bytes });
  });
  afterAll(async () => {
    if (previousRoot === undefined) delete process.env.TEXTTEXT_VAULT_ROOT;
    else process.env.TEXTTEXT_VAULT_ROOT = previousRoot;
    if (db) {
      await db.delete(schema.actionAudit).where(eq(schema.actionAudit.targetId, targetId));
      await db.delete(schema.blogs).where(eq(schema.blogs.id, workspaceId));
      await db.delete(schema.users).where(eq(schema.users.id, actorUserId));
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("audits only explicit publication changes and revokes the public read", async () => {
    const original = (await store.readVaultPublication({ root, workspaceId, itemId }))!;
    expect(await store.readPublicVaultItem({ workspaceId, itemId })).toBeNull();
    const operationId = randomUUID();
    const publish = { root, workspaceId, itemId, operationId, baseRevision: original.revision,
      published: true, actorUserId, actorType: "human" as const };
    expect((await store.mutateVaultPublication(publish)).status).toBe("written");
    expect((await store.mutateVaultPublication(publish)).status).toBe("written");
    expect((await store.readPublicVaultItem({ workspaceId, itemId }))?.document.content.body).toBe("Saved content");
    const current = (await store.readVaultPublication({ root, workspaceId, itemId }))!;
    expect((await store.mutateVaultPublication({ ...publish, operationId: randomUUID(),
      baseRevision: current.revision, published: false })).status).toBe("written");
    expect(await store.readPublicVaultItem({ workspaceId, itemId })).toBeNull();
    const rows = await db.select({ actionName: schema.actionAudit.actionName,
      inputSummary: schema.actionAudit.inputSummary,
      outputSummary: schema.actionAudit.outputSummary }).from(schema.actionAudit)
      .where(eq(schema.actionAudit.targetId, targetId));
    expect(rows.map(row => row.actionName).sort()).toEqual(["vault.publish", "vault.unpublish"]);
    expect(JSON.stringify(rows)).not.toContain("Saved content");
  });
});
