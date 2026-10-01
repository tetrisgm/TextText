import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1";
describe.skipIf(!enabled)("file-vault grants against local Postgres", () => {
  let db: NonNullable<typeof import("@/lib/db/client").db>;
  let schema: typeof import("@/lib/db/schema");
  let grants: typeof import("./grants");
  let root: string;
  const ownerId = randomUUID(), otherOwnerId = randomUUID(), memberId = randomUUID();
  const workspaceId = randomUUID(), otherWorkspaceId = randomUUID();
  const itemId = randomUUID();
  const email = `vault-grant-${randomUUID()}@example.test`;
  const handles = [`vault-share-${randomUUID()}`, `vault-share-${randomUUID()}`];
  let oldFolderPath: string;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    const client = await import("@/lib/db/client");
    if (!client.db) throw new Error("Local database is required");
    db = client.db; schema = await import("@/lib/db/schema"); grants = await import("./grants");
    root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-vault-grants-"));
    await fs.mkdir(path.join(root, workspaceId, "Reading"), { recursive: true });
    oldFolderPath = path.join(root, workspaceId, "Reading");
    await db.insert(schema.users).values([{ id: ownerId, name: "Grant owner" },
      { id: otherOwnerId, name: "Other grant owner" }, { id: memberId, name: "Grant member", email }]);
    await db.insert(schema.blogs).values([
      { id: workspaceId, handle: handles[0], name: "Shared fixture", ownerId },
      { id: otherWorkspaceId, handle: handles[1], name: "Other fixture", ownerId: otherOwnerId },
    ]);
    // The legacy row names a post id and cannot authorize this TextPack.
    await db.insert(schema.collaborators).values({ scopeType: "item", scopeId: itemId,
      userId: memberId, role: "editor", invitedById: ownerId });
  });

  afterAll(async () => {
    if (db) {
      await db.delete(schema.actionAudit).where(inArray(schema.actionAudit.targetId,
        [`${workspaceId}:${itemId}`, `${workspaceId}:Reading`, `${otherWorkspaceId}:${itemId}`]));
      await db.delete(schema.vaultGrants).where(inArray(schema.vaultGrants.workspaceId, [workspaceId, otherWorkspaceId]));
      await db.delete(schema.collaborators).where(eq(schema.collaborators.scopeId, itemId));
      await db.delete(schema.blogs).where(inArray(schema.blogs.id, [workspaceId, otherWorkspaceId]));
      await db.delete(schema.users).where(inArray(schema.users.id, [ownerId, otherOwnerId, memberId]));
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("requires a separate workspace-qualified grant and retains it across item moves", async () => {
    expect(await grants.activeVaultGrants({ root, workspaceId, userId: memberId })).toEqual([]);
    const scope = { type: "item", key: itemId } as const;
    await grants.inviteVaultGrant({ root, workspaceId, scope, email: email.toUpperCase(), role: "editor", actorUserId: ownerId });
    const current = await grants.activeVaultGrants({ root, workspaceId, userId: memberId });
    expect(grants.roleForVaultItem(current, itemId, "Private/One.textpack")).toBe("editor");
    expect(grants.roleForVaultItem(current, itemId, "Moved/One.textpack")).toBe("editor");
    expect(grants.roleForVaultItem(current, randomUUID(), "Private/Sibling.textpack")).toBeNull();
    expect(await grants.activeVaultGrants({ root, workspaceId: otherWorkspaceId, userId: memberId })).toEqual([]);
  });

  it("limits folder grants to descendants and closes a replaced directory", async () => {
    const scope = { type: "folder", key: "Reading" } as const;
    await grants.inviteVaultGrant({ root, workspaceId, scope, email, role: "viewer", actorUserId: ownerId });
    const active = await grants.activeVaultGrants({ root, workspaceId, userId: memberId });
    expect(grants.roleForVaultItem(active, randomUUID(), "Reading/Article.textpack")).toBe("viewer");
    expect(grants.roleForVaultItem(active, randomUUID(), "Reading/Nested/Article.textpack")).toBe("viewer");
    expect(grants.roleForVaultItem(active, randomUUID(), "Reading Elsewhere/Article.textpack")).toBeNull();
    expect(grants.roleForVaultItem(active, randomUUID(), "Private/Sibling.textpack")).toBeNull();
    await fs.rename(oldFolderPath, `${oldFolderPath}-moved`);
    await fs.mkdir(oldFolderPath);
    const afterReplacement = await grants.activeVaultGrants({ root, workspaceId, userId: memberId });
    expect(grants.roleForVaultItem(afterReplacement, randomUUID(), "Reading/New.textpack")).toBeNull();
  });

  it("audits role changes and revocation, and refuses a non-owner grant change", async () => {
    const scope = { type: "item", key: itemId } as const;
    const [existing] = await grants.listVaultGrants(workspaceId, scope);
    await expect(grants.changeVaultGrant({ root, workspaceId, scope, grantId: existing.id, role: "viewer", actorUserId: memberId }))
      .rejects.toThrow(/owner/);
    expect(await grants.changeVaultGrant({ root, workspaceId, scope, grantId: existing.id, role: "viewer", actorUserId: ownerId })).toBe(true);
    expect(grants.roleForVaultItem(await grants.activeVaultGrants({ root, workspaceId, userId: memberId }), itemId, "Private/One.textpack")).toBe("viewer");
    expect(await grants.changeVaultGrant({ root, workspaceId, scope, grantId: existing.id, revoke: true, actorUserId: ownerId })).toBe(true);
    expect(await grants.changeVaultGrant({ root, workspaceId, scope, grantId: existing.id, revoke: true, actorUserId: ownerId })).toBe(false);
    const rows = await db.select({ actionName: schema.actionAudit.actionName }).from(schema.actionAudit).where(and(
      eq(schema.actionAudit.targetId, `${workspaceId}:${itemId}`),
    ));
    expect(rows.map(row => row.actionName)).toEqual(["vault.share.invite", "vault.share.role", "vault.share.revoke"]);
  });
});
