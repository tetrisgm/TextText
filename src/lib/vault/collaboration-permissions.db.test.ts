import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1";
describe.skipIf(!enabled)("fresh vault workspace permissions against local Postgres", () => {
  let db: NonNullable<typeof import("@/lib/db/client").db>;
  let schema: typeof import("@/lib/db/schema");
  let access: typeof import("@/lib/permissions").resolveWorkspaceAccess;
  let identity: typeof import("@/lib/store").getVaultWorkspaceIdentity;
  const ownerId = randomUUID(), memberId = randomUUID(), workspaceId = randomUUID(), grantId = randomUUID();
  const handle = `vault-permissions-${randomUUID()}`;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    const client = await import("@/lib/db/client");
    if (!client.db) throw new Error("Local database is required");
    db = client.db; schema = await import("@/lib/db/schema");
    access = (await import("@/lib/permissions")).resolveWorkspaceAccess;
    identity = (await import("@/lib/store")).getVaultWorkspaceIdentity;
    await db.insert(schema.users).values([{ id: ownerId, name: "Vault permission fixture owner" }, { id: memberId, name: "Vault permission fixture member" }]);
    await db.insert(schema.blogs).values({ id: workspaceId, handle, name: "Vault permission fixture", ownerId });
    await db.insert(schema.collaborators).values({ id: grantId, scopeId: workspaceId, scopeType: "workspace", userId: memberId, role: "member", invitedById: ownerId });
  });
  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.collaborators).where(eq(schema.collaborators.id, grantId));
    await db.delete(schema.blogs).where(eq(schema.blogs.id, workspaceId));
    await db.delete(schema.users).where(inArray(schema.users.id, [ownerId, memberId]));
  });
  it("resolves a named workspace and observes grant downgrade and revocation immediately", async () => {
    expect(await identity(workspaceId)).toEqual({ id: workspaceId, handle, name: "Vault permission fixture", ownerId });
    const request = { handle, user: { userId: memberId }, fresh: true };
    const freshlyLoaded = async () => access({ ...request, workspaceSnapshot: (await identity(workspaceId))! });
    expect(await freshlyLoaded()).toMatchObject({ canView: true, canEditContent: true, isOwner: false });
    await db.update(schema.collaborators).set({ role: "commenter" }).where(eq(schema.collaborators.id, grantId));
    expect(await freshlyLoaded()).toMatchObject({ canView: true, canEditContent: false, canComment: true });
    await db.update(schema.collaborators).set({ role: "viewer" }).where(eq(schema.collaborators.id, grantId));
    expect(await freshlyLoaded()).toMatchObject({ canView: true, canEditContent: false, canComment: false });
    await db.update(schema.collaborators).set({ revokedAt: new Date() }).where(eq(schema.collaborators.id, grantId));
    expect(await freshlyLoaded()).toMatchObject({ canView: false, canEditContent: false });
  });
  it("never promotes an item grant to workspace access", async () => {
    await db.update(schema.collaborators).set({ revokedAt: null, role: "editor", scopeType: "item" }).where(eq(schema.collaborators.id, grantId));
    expect(await access({ handle, user: { userId: memberId }, fresh: true })).toMatchObject({ canView: false, canEditContent: false });
    expect(await access({ handle, user: { userId: ownerId }, fresh: true })).toMatchObject({ isOwner: true, canEditContent: true });
  });
  it("rechecks ownership and deleted workspaces without a request cache", async () => {
    await db.update(schema.blogs).set({ ownerId: memberId }).where(eq(schema.blogs.id, workspaceId));
    expect(await access({ handle, user: { userId: ownerId }, fresh: true,
      workspaceSnapshot: (await identity(workspaceId))! })).toMatchObject({ isOwner: false, canView: false });
    expect(await access({ handle, user: { userId: memberId }, fresh: true,
      workspaceSnapshot: (await identity(workspaceId))! })).toMatchObject({ isOwner: true });
    await db.update(schema.blogs).set({ deletedAt: new Date() }).where(eq(schema.blogs.id, workspaceId));
    expect(await identity(workspaceId)).toBeNull();
    expect(await access({ handle, user: { userId: memberId }, fresh: true })).toMatchObject({ canView: false });
  });
});
