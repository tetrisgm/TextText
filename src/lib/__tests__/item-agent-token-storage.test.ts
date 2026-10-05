import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ insert: vi.fn(), execute: vi.fn(), transaction: vi.fn(), batch: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { insert: mocks.insert, execute: mocks.execute, transaction: mocks.transaction }, executeAtomicBatch: mocks.batch }));
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
  mocks.transaction.mockImplementation(async (build) => build({ execute: mocks.execute }));
  mocks.execute.mockResolvedValue({ rows: [] });
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
  it("revokes a manual token for its owner and audits only a changed row", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: tokenId }] });
    const entry = { ...audit, actionName: "agent.item.disconnect" };
    expect(await revokeApiToken(userId, tokenId, entry)).toBe(true);
    const compiled = new PgDialect().sqlToQuery(mocks.execute.mock.calls[1][0]);
    expect(compiled.sql).toContain('revoked_at IS NULL');
    expect(compiled.sql).toContain('RETURNING id');
    for (const value of [userId, tokenId]) expect(compiled.params).toContain(value);
    expect(mocks.audit).toHaveBeenCalledWith(entry, expect.anything());
    expect(await revokeApiToken(userId, tokenId, audit)).toBe(false);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("revokes the whole OAuth family, including tokens issued after rotation", async () => {
    const familyId = "44444444-4444-4444-8444-444444444444";
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ family_id: familyId }] })
      .mockResolvedValueOnce({ rows: [{ id: familyId }] })
      .mockResolvedValueOnce({ rows: [{ id: familyId }] })
      .mockResolvedValueOnce({ rows: [{ id: tokenId }] });
    expect(await revokeApiToken(userId, tokenId, audit)).toBe(true);
    const queries = mocks.execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query));
    expect(queries[1].sql).toContain('FOR UPDATE');
    expect(queries[2].sql).toContain('connector_oauth_refresh_token_families');
    expect(queries[3].sql).toContain('connector_oauth_access_tokens');
    expect(queries[3].sql).toContain('revoked_at IS NULL');
    expect(queries[3].params).toContain(familyId);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});
