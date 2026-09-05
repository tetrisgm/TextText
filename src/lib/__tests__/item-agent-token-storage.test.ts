import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ insert: vi.fn(), execute: vi.fn(), batch: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { insert: mocks.insert, execute: mocks.execute }, executeAtomicBatch: mocks.batch }));
vi.mock("@/lib/audit", async (original) => ({ ...await original<typeof import("@/lib/audit")>(), auditInsertQuery: mocks.audit }));
import { createApiToken, hashApiToken, revokeApiToken } from "../api-tokens";
const itemId = "11111111-1111-4111-8111-111111111111";
const tokenId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const audit = { actorUserId: userId, actorType: "human" as const, actionName: "agent.item.connect", targetType: "item" as const, targetId: itemId };
let values: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.insert.mockReturnValue({ values: (input: Record<string, unknown>) => { values = input; return { returning: () => Promise.resolve([{ ...input, id: tokenId, createdAt: new Date("2026-09-05T00:00:00Z"), lastUsedAt: null }]) }; } });
  mocks.audit.mockReturnValue(Promise.resolve([]));
  mocks.batch.mockImplementation(async (build) => Promise.all(build({ insert: mocks.insert })));
  mocks.execute.mockResolvedValue({ rows: [{ id: tokenId }] });
});
describe("item grant storage", () => {
  it("inserts only the hash and commits creation with its audit in one batch", async () => {
    const expiresAt = new Date("2026-09-12T00:00:00Z");
    const result = await createApiToken(userId, "Codex", { scopes: `item:${itemId}:edit`, kind: "mcp", expiresAt, audit });
    expect(values).toMatchObject({ userId, tokenHash: hashApiToken(result.raw), expiresAt, scopes: `item:${itemId}:edit` });
    expect(JSON.stringify(values)).not.toContain(result.raw);
    expect(JSON.stringify(result.record)).not.toContain(result.raw);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(audit, expect.anything());
  });
  it("does not return a secret when the atomic batch fails", async () => {
    mocks.batch.mockRejectedValue(new Error("audit insert failed"));
    await expect(createApiToken(userId, "Codex", { audit })).rejects.toThrow("audit insert failed");
  });
  it("revocation SQL guards owner and live token and audits only a changed row", async () => {
    expect(await revokeApiToken(userId, tokenId, { ...audit, actionName: "agent.item.disconnect" })).toBe(true);
    const compiled = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(compiled.sql).toContain('WITH changed AS');
    expect(compiled.sql).toContain('revoked_at IS NULL');
    expect(compiled.sql).toContain('INSERT INTO "action_audit"');
    expect(compiled.sql).toContain('FROM "changed"');
    for (const value of [userId, tokenId, itemId, "agent.item.disconnect"]) expect(compiled.params).toContain(value);
    mocks.execute.mockResolvedValue({ rows: [] });
    expect(await revokeApiToken(userId, tokenId, audit)).toBe(false);
  });
});
