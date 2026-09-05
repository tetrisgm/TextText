import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodePresenceAwareness } from "@/lib/collab/presence-awareness";
const mocks = vi.hoisted(() => ({ batch: vi.fn(), rows: [] as unknown[], statements: [] as Array<{ sql: string; params: unknown[] }> }));
vi.mock("@/lib/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const db = drizzle.mock();
  db.select = vi.fn(() => ({ from: () => ({ where: async () => mocks.rows }) })) as unknown as typeof db.select;
  return {
    db,
    executeAtomicBatch: (build: (tx: typeof db) => Array<{ toSQL(): { sql: string; params: unknown[] } }>) => {
      mocks.statements = build(db).map((query) => query.toSQL());
      return mocks.batch();
    },
  };
});
vi.mock("@/lib/store", () => ({ getPostStoreContext: vi.fn() }));
import { activePresence, hasActiveCoEditors, removePresence, upsertPresence } from "@/lib/collab";
const postId = "10000000-0000-4000-8000-000000000001";
const actorUserId = "10000000-0000-4000-8000-000000000002";
function row(role: "editor" | "viewer", clientId = "p-session") {
  return {
    clientId, userName: "Ada", color: "#112233", updatedAt: new Date(),
    awareness: encodePresenceAwareness(10, 1, { user: { clientId, role, participantType: "person" } }),
  };
}
beforeEach(() => { mocks.rows = []; mocks.statements = []; mocks.batch.mockReset().mockResolvedValue([]); });
describe("presence persistence", () => {
  it("excludes viewers and legacy human rows from the active-editor signal", async () => {
    mocks.rows = [row("viewer"), row("editor", "c-legacy")];
    expect(await hasActiveCoEditors(postId)).toBe(false);
    expect(await activePresence(postId)).toHaveLength(1);
    mocks.rows.push(row("editor", "p-editor"));
    expect(await hasActiveCoEditors(postId)).toBe(true);
    expect(await hasActiveCoEditors(postId, "p-editor")).toBe(false);
    mocks.rows = [row("editor", "agent-authorized")];
    expect(await hasActiveCoEditors(postId)).toBe(true);
  });
  it("atomically batches heartbeat, stale cleanup and credential-free action_audit", async () => {
    await upsertPresence(postId, { ...row("editor"), actorUserId });
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.statements).toHaveLength(3);
    expect(mocks.statements[0].sql).toContain('insert into "collab_presence"');
    expect(mocks.statements[1].sql).toContain('delete from "collab_presence"');
    expect(mocks.statements[2].sql).toContain('insert into "action_audit"');
    expect(mocks.statements[2].params).toContain(actorUserId);
    expect(mocks.statements[2].params).toContain("collab.presence.update");
    expect(mocks.statements[2].params).not.toContain(row("editor").awareness);
  });
  it("scopes leave to exactly the item and authorized session and audits in the same batch", async () => {
    await removePresence(postId, "p-session", {
      actorUserId, actorType: "human", actionName: "collab.presence.leave", targetType: "item", targetId: postId,
    });
    expect(mocks.statements[0].sql).toMatch(/"post_id" = .* and .*"client_id" =/);
    expect(mocks.statements[0].params).toEqual([postId, "p-session"]);
    expect(mocks.statements[1].sql).toContain('insert into "action_audit"');
    expect(mocks.statements[1].params).toContain(actorUserId);
  });
  it("does not report success when the atomic mutation/audit batch fails", async () => {
    mocks.batch.mockRejectedValue(new Error("transaction failed"));
    await expect(upsertPresence(postId, row("viewer"))).rejects.toThrow("transaction failed");
    await expect(removePresence(postId, "p-session")).rejects.toThrow("transaction failed");
  });
});
