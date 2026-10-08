import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
vi.mock("@/lib/store", () => ({ getBlogEditRecord: vi.fn() }));
vi.mock("@/lib/mcp/tools", () => ({ runWorkspaceToolForSession: vi.fn() }));
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("durable PostgreSQL proposal staging", () => {
  const userId = randomUUID(), blogId = randomUUID(), handle = `staging-${randomUUID()}`;
  let client: typeof import("@/lib/db/client");
  let schema: typeof import("@/lib/db/schema");
  let service: typeof import("@/lib/ai/write-proposals.server");
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Only local Postgres is allowed");
    client = await import("@/lib/db/client"); schema = await import("@/lib/db/schema");
    service = await import("@/lib/ai/write-proposals.server");
    await client.db!.insert(schema.users).values({ id: userId });
    await client.db!.insert(schema.blogs).values({ id: blogId, handle, name: "Isolated staging test", ownerId: userId });
  });
  afterAll(async () => {
    if (!client?.db) return;
    await client.db.delete(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    await client.db.delete(schema.blogs).where(eq(schema.blogs.id, blogId));
    await client.db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.closeDatabaseConnections();
  });
  it("commits one frozen proposal and one audit under concurrent retries", async () => {
    const execute = vi.fn();
    const dependencies = {
      repository: service.databaseWorkspaceWriteProposalRepository,
      resolveWorkspace: async () => ({ id: blogId, handle, ownerId: userId }),
      resolveItems: async () => new Map(), execute, now: () => new Date(), randomId: randomUUID,
    };
    const input = { actor: { sub: "fixture", userId, handle, actorType: "human" as const },
      tool: "create_item", arguments: { capture: "Only one proposed note" }, stagingKey: randomUUID() };
    const results = await Promise.all(Array.from({ length: 8 }, () => service.createWorkspaceWriteProposal(input, dependencies)));
    for (const result of results) expect(result).toEqual(results[0]);
    const rows = await client.db!.select().from(schema.aiWriteProposals).where(eq(schema.aiWriteProposals.blogId, blogId));
    expect(rows).toHaveLength(1);
    const audit = await client.db!.select().from(schema.actionAudit).where(eq(schema.actionAudit.targetId, results[0].id));
    expect(audit).toHaveLength(1); expect(audit[0].actionName).toBe("ai.write_proposed");
    await expect(service.createWorkspaceWriteProposal({ ...input, arguments: { capture: "Changed intent" } }, dependencies)).rejects.toThrow("different change");
    expect(await service.createWorkspaceWriteProposal(input, dependencies)).toEqual(results[0]);
    expect(execute).not.toHaveBeenCalled();
  });
});
