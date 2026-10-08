import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && !!process.env.DATABASE_URL;
it.skipIf(!enabled)("previews authoritative files and gates durable moves at the content boundary", async () => {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw Error("Local PostgreSQL only");
  const { db } = await import("@/lib/db/client");
  if (!db) throw Error("Missing database");
  const { users, blogs, vaultGrants, vaultFolderMoves, actionAudit } = await import("@/lib/db/schema");
  const { previewVaultFolderMove, moveVaultFolder } = await import("@/lib/store");
  const { vaultFolderSignature } = await import("./folder-identity");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-move-boundary-"));
  const workspaceId = crypto.randomUUID(), actorUserId = crypto.randomUUID(), grantId = crypto.randomUUID();
  const location = { root, workspaceId, actorUserId };
  try {
    await db.insert(users).values({ id: actorUserId, name: "Move boundary fixture" });
    await db.insert(blogs).values({ id: workspaceId, ownerId: actorUserId, handle: `move-${workspaceId}`, name: "Move fixture" });
    await fs.mkdir(path.join(root, workspaceId, "Source/Empty"), { recursive: true });
    await fs.mkdir(path.join(root, workspaceId, "Archive"));
    const signature = (await vaultFolderSignature(root, workspaceId, "Source"))!;
    await db.insert(vaultGrants).values({ id: grantId, workspaceId, scopeType: "folder", scopeKey: "Source", folderSignature: signature, invitedEmail: "reader@example.com", role: "viewer", invitedById: actorUserId });

    await expect(previewVaultFolderMove({ ...location, actorUserId: crypto.randomUUID(), source: "Source", destination: "Archive/Moved" })).rejects.toThrow("Only the workspace owner");
    const preview = await previewVaultFolderMove({ ...location, source: "Source", destination: "Archive/Moved" });
    expect(preview.plan.folders).toContainEqual({ from: "Source/Empty", to: "Archive/Moved/Empty" });
    expect(preview.plan.movedGrants).toContainEqual(expect.objectContaining({ id: grantId, destination: "Archive/Moved" }));
    expect(await db.select().from(vaultFolderMoves).where(eq(vaultFolderMoves.workspaceId, workspaceId))).toHaveLength(0);
    const request = { ...location, ...preview, operationId: "boundary-move", actorType: "human" as const };
    await expect(moveVaultFolder({ ...request, reviewedPlanHash: "0".repeat(64) })).rejects.toThrow("Reviewed folder move changed");
    await expect(moveVaultFolder({ ...request, authorize: async () => { throw Error("Access revoked"); } })).rejects.toThrow("Access revoked");
    await fs.mkdir(path.join(root, workspaceId, "Source/Later"));
    await expect(moveVaultFolder(request)).rejects.toThrow("Workspace changed");
    expect(await fs.stat(path.join(root, workspaceId, "Source/Empty"))).toBeTruthy();
    expect(await db.select().from(vaultFolderMoves).where(eq(vaultFolderMoves.workspaceId, workspaceId))).toHaveLength(0);

    await db.insert(vaultGrants).values({ id: crypto.randomUUID(), workspaceId, scopeType: "folder", scopeKey: "Archive", folderSignature: (await vaultFolderSignature(root, workspaceId, "Archive"))!, invitedEmail: "destination@example.com", role: "editor", invitedById: actorUserId });
    const refreshed = await previewVaultFolderMove({ ...location, source: "Source", destination: "Archive/Moved" });
    expect(refreshed.plan.addedAccess).toContainEqual({ email: "destination@example.com", role: "editor", via: "Archive" });
    await expect(moveVaultFolder({ ...request, ...refreshed })).rejects.toThrow("Review the additional folder access");
    const approved = { ...request, ...refreshed, reviewedAccessExpansion: true };
    expect(await moveVaultFolder(approved)).toEqual({ status: "folder_moved", relativePath: "Archive/Moved" });
    expect(await moveVaultFolder(approved)).toEqual({ status: "folder_moved", relativePath: "Archive/Moved" });
    expect(await fs.stat(path.join(root, workspaceId, "Archive/Moved/Empty"))).toBeTruthy();
    expect(await fs.stat(path.join(root, workspaceId, "Archive/Moved/Later"))).toBeTruthy();
    expect((await db.select().from(vaultGrants).where(eq(vaultGrants.id, grantId)))[0]).toMatchObject({ scopeKey: "Archive/Moved", folderSignature: signature, role: "viewer" });
    expect(await db.select().from(actionAudit).where(eq(actionAudit.actorUserId, actorUserId))).toHaveLength(1);
  } finally {
    await db.delete(vaultFolderMoves).where(eq(vaultFolderMoves.workspaceId, workspaceId));
    await db.delete(vaultGrants).where(eq(vaultGrants.workspaceId, workspaceId));
    await db.delete(actionAudit).where(eq(actionAudit.actorUserId, actorUserId));
    await db.delete(blogs).where(eq(blogs.id, workspaceId));
    await db.delete(users).where(eq(users.id, actorUserId));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
