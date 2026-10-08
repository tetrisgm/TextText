import { expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && !!process.env.DATABASE_URL;
it.skipIf(!enabled)("persists local CLI proposals for owner review without executing their writes", async () => {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw Error("Local PostgreSQL only");
  const { db } = await import("@/lib/db/client");
  if (!db) throw Error("Missing local database");
  const { users, blogs, aiWriteProposals, actionAudit, folders } = await import("@/lib/db/schema");
  const { stageAgentToolProposal } = await import("@/lib/mcp/write-proposals");
  const { getWorkspaceWriteProposalForReview } = await import("@/lib/ai/write-proposals.server");
  const ownerId = crypto.randomUUID(), workspaceId = crypto.randomUUID();
  const sub = `cli-proposal-${ownerId}`, handle = `cli-proposal-${ownerId}`;
  const root = await mkdtemp(path.join(os.tmpdir(), "texttext-cli-proposal-"));
  const previousRoot = process.env.TEXTTEXT_VAULT_ROOT;
  process.env.TEXTTEXT_VAULT_ROOT = root;
  try {
    await db.insert(users).values({ id: ownerId, appleSub: sub, name: "CLI proposal fixture" });
    await db.insert(blogs).values({ id: workspaceId, ownerId, handle, name: "CLI proposal fixture" });
    const result = await stageAgentToolProposal("create_folder", { parent_path: "", name: "Review only", idempotency_key: "caller-key" }, {
      authInfo: { token: "fixture", clientId: "fixture", scopes: ["sync"], extra: { sub, userId: ownerId, connectionName: "Local fixture" } },
    }, "local_cli");
    expect(result.isError).not.toBe(true);
    const [stored] = await db.select().from(aiWriteProposals).where(eq(aiWriteProposals.blogId, workspaceId));
    expect(stored.status).toBe("pending");
    expect(stored.metadata).toMatchObject({ agentActorType: "external_agent" });
    expect(stored.arguments).toMatchObject({ parent_path: "", name: "Review only", idempotency_key: `proposal:${stored.id}` });
    const review = await getWorkspaceWriteProposalForReview({ sub, userId: ownerId, handle }, stored.id);
    expect(review).toMatchObject({ id: stored.id, tool: "create_folder", status: "pending", origin: { surface: "local_cli", connectionName: "Local fixture" } });
    expect(await getWorkspaceWriteProposalForReview({ sub, userId: crypto.randomUUID(), handle }, stored.id)).toBeNull();
    expect(await readdir(root)).toEqual([]);
    expect(await db.select().from(folders).where(eq(folders.blogId, workspaceId))).toEqual([]);
  } finally {
    if (previousRoot === undefined) delete process.env.TEXTTEXT_VAULT_ROOT; else process.env.TEXTTEXT_VAULT_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
    await db.delete(aiWriteProposals).where(eq(aiWriteProposals.blogId, workspaceId));
    await db.delete(actionAudit).where(eq(actionAudit.actorUserId, ownerId));
    await db.delete(blogs).where(eq(blogs.id, workspaceId));
    await db.delete(users).where(eq(users.id, ownerId));
  }
}, 30000);
