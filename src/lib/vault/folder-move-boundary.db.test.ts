import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && !!process.env.DATABASE_URL;
it.skipIf(!enabled)("previews authoritative files and gates durable moves at the content boundary", async () => {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw Error("Local PostgreSQL only");
  const { db } = await import("@/lib/db/client");
  if (!db) throw Error("Missing database");
  const { users, blogs, vaultGrants, vaultFolderMoves, actionAudit, aiWriteProposals } = await import("@/lib/db/schema");
  const { previewVaultFolderMove, moveVaultFolder } = await import("@/lib/store");
  const { vaultFolderSignature } = await import("./folder-identity");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-move-boundary-"));
  const workspaceId = crypto.randomUUID(), actorUserId = crypto.randomUUID(), grantId = crypto.randomUUID();
  const location = { root, workspaceId, actorUserId };
  const previousRoot = process.env.TEXTTEXT_VAULT_ROOT;
  process.env.TEXTTEXT_VAULT_ROOT = root;
  const sub = `folder-proposal-${actorUserId}`, handle = `move-${workspaceId}`;
  try {
    await db.insert(users).values({ id: actorUserId, appleSub:sub, name: "Move boundary fixture" });
    await db.insert(blogs).values({ id: workspaceId, ownerId: actorUserId, handle, name: "Move fixture" });
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
    await expect(moveVaultFolder({...approved,receiptOnly:true})).rejects.toThrow("No completed receipt");
    expect(await fs.stat(path.join(root,workspaceId,"Source/Empty"))).toBeTruthy();
    expect(await moveVaultFolder(approved)).toEqual({ status: "folder_moved", relativePath: "Archive/Moved" });
    expect(await moveVaultFolder({...approved,receiptOnly:true})).toEqual({ status: "folder_moved", relativePath: "Archive/Moved" });
    expect(await moveVaultFolder(approved)).toEqual({ status: "folder_moved", relativePath: "Archive/Moved" });
    expect(await fs.stat(path.join(root, workspaceId, "Archive/Moved/Empty"))).toBeTruthy();
    expect(await fs.stat(path.join(root, workspaceId, "Archive/Moved/Later"))).toBeTruthy();
    expect((await db.select().from(vaultGrants).where(eq(vaultGrants.id, grantId)))[0]).toMatchObject({ scopeKey: "Archive/Moved", folderSignature: signature, role: "viewer" });
    expect(await db.select().from(actionAudit).where(eq(actionAudit.actorUserId, actorUserId))).toHaveLength(1);

    // Exercise the public hosted staging path and the real stored approval,
    // rather than substituting a mock executor for the file/grant transaction.
    const { callTool } = await import("@/lib/mcp/registry");
    const { executeMcpTool } = await import("@/lib/mcp/tools");
    const { decideWorkspaceWriteProposal, getWorkspaceWriteProposalForReview } = await import("@/lib/ai/write-proposals.server");
    const { emptyDocumentSnapshot } = await import("@/lib/documents/model");
    const { buildTextpack } = await import("@/lib/github/textpack");
    await fs.mkdir(path.join(root,workspaceId,"Second/Empty"),{recursive:true});
    const document = emptyDocumentSnapshot(); document.content.title="Agent file stays intact"; document.content.body="Exact original body.";
    const bytes = buildTextpack("Note",{document,markdown:`---\ntextTextId: ${crypto.randomUUID()}\n---\n\nExact original body.`});
    await fs.writeFile(path.join(root,workspaceId,"Second/Note.textpack"),bytes);
    const args = {source_path:"Second",destination_path:"Archive/Second",idempotency_key:"agent-proposal"};
    const auth = {authInfo:{token:"fixture",clientId:actorUserId,scopes:["sync"],extra:{sub,userId:actorUserId,workspaceHandle:handle}}};
    expect((await executeMcpTool("move_folder_tree",args,auth)).isError).toBe(true);
    const staged = await callTool("move_folder_tree",args,auth);
    expect(staged.isError).not.toBe(true);
    const proposalId = staged.structuredContent!.proposalId as string;
    expect(staged.structuredContent).toMatchObject({approvalRequired:true});
    expect(await fs.readFile(path.join(root,workspaceId,"Second/Note.textpack"))).toEqual(Buffer.from(bytes));
    const actor = {sub,userId:actorUserId,handle};
    expect(await getWorkspaceWriteProposalForReview(actor,proposalId)).toMatchObject({workspaceUrl:`/vault/${workspaceId}`,additionalAccess:[{email:"destination@example.com",role:"editor",via:"Archive"}]});
    expect(await decideWorkspaceWriteProposal({actor,proposalId,decision:"approve"})).toMatchObject({status:"failed"});
    await db.update(users).set({appleSub:`revoked-${sub}`}).where(eq(users.id,actorUserId));
    expect(await decideWorkspaceWriteProposal({actor,proposalId,decision:"approve",acknowledgeAccessExpansion:true})).toMatchObject({status:"ambiguous"});
    expect(await fs.readFile(path.join(root,workspaceId,"Second/Note.textpack"))).toEqual(Buffer.from(bytes));
    await db.update(users).set({appleSub:sub}).where(eq(users.id,actorUserId));
    // Recovery uses the persisted acknowledgement, not a new browser flag.
    expect(await decideWorkspaceWriteProposal({actor,proposalId,decision:"approve"})).toMatchObject({status:"completed"});
    expect(await decideWorkspaceWriteProposal({actor,proposalId,decision:"approve"})).toMatchObject({status:"completed"});
    expect(await fs.readFile(path.join(root,workspaceId,"Archive/Second/Note.textpack"))).toEqual(Buffer.from(bytes));
    expect(await fs.stat(path.join(root,workspaceId,"Archive/Second/Empty"))).toBeTruthy();
    expect(await db.select().from(actionAudit).where(and(eq(actionAudit.actorUserId,actorUserId),eq(actionAudit.actionName,"vault.folder.move")))).toHaveLength(2);
  } finally {
    if(previousRoot === undefined) delete process.env.TEXTTEXT_VAULT_ROOT; else process.env.TEXTTEXT_VAULT_ROOT=previousRoot;
    await db.delete(aiWriteProposals).where(eq(aiWriteProposals.blogId,workspaceId));
    await db.delete(vaultFolderMoves).where(eq(vaultFolderMoves.workspaceId, workspaceId));
    await db.delete(vaultGrants).where(eq(vaultGrants.workspaceId, workspaceId));
    await db.delete(actionAudit).where(eq(actionAudit.actorUserId, actorUserId));
    await db.delete(blogs).where(eq(blogs.id, workspaceId));
    await db.delete(users).where(eq(users.id, actorUserId));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
