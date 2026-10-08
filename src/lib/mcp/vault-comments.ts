import { createHash } from "node:crypto";
import { listVaultItemComments, mutateVaultItemComments } from "@/lib/store";
import type { VaultCommentMutation, VaultItemComment } from "@/lib/vault/item-comments";
export type VaultCommentContext = {
  receiptOnly?: boolean;
  root: string; workspaceId: string; actorUserId: string; actorName: string;
  actorType?: "human" | "external_agent";
  /** Stable UUID from the authenticated request, reused on retry. */
  operationId: string;
  authorize: (itemId: string, path: string, write: boolean) => Promise<void>;
};
export async function executeVaultCommentTool(name: string, args: Record<string, unknown>, context: VaultCommentContext) {
  if (!["list_comments", "add_comment", "set_comment_resolved"].includes(name)) throw new Error("Unsupported comment command");
  const keys = name === "list_comments" ? ["id", "state"] : name === "add_comment" ? ["id", "body", "parent_comment_id", "idempotency_key"] : ["id", "comment_id", "resolved", "idempotency_key"];
  if (Object.keys(args).some(key => !keys.includes(key))) throw new Error("File comments do not support these fields or quote anchors");
  if (typeof args.id !== "string") throw new Error("Item not found");
  const itemId = args.id, write = name !== "list_comments";
  await context.authorize(itemId, "", write);
  const location = { receiptOnly: context.receiptOnly, root: context.root, workspaceId: context.workspaceId, itemId };
  if (!write) {
    if (args.state !== undefined && !["open", "resolved", "all"].includes(String(args.state))) throw new Error("Invalid comment state");
    const comments: VaultItemComment[] = [];
    let after: string | null = null, revision: string | undefined;
    do {
      const page = await listVaultItemComments({ ...location, limit: 100, after });
      if (!page) throw new Error("Item not found");
      await context.authorize(itemId, page.relativePath, false);
      if (revision && revision !== page.revision) throw new Error("Comments changed while reading. Read them again.");
      revision = page.revision; comments.push(...page.comments); after = page.nextCursor;
      if (comments.length > 500) throw new Error("Comment limit exceeded");
    } while (after);
    const state = args.state ?? "open";
    const roots = new Map(comments.filter(comment => !comment.parentId).map(comment => [comment.id, Boolean(comment.resolvedAt)]));
    return { comments: comments.filter(comment => state === "all" || roots.get(comment.parentId ?? comment.id) === (state === "resolved")), revision };
  }
  let mutation: VaultCommentMutation;
  if (name === "add_comment") {
    if (typeof args.body !== "string" || !args.body.trim() || args.body.trim().length > 4000) throw new Error("Comments must contain 1 to 4000 characters");
    if (args.parent_comment_id !== undefined && typeof args.parent_comment_id !== "string") throw new Error("Invalid reply parent");
    mutation = { kind: "create", body: args.body, parentId: args.parent_comment_id as string | undefined };
  } else {
    if (typeof args.comment_id !== "string" || typeof args.resolved !== "boolean") throw new Error("Invalid comment resolution");
    mutation = { kind: "resolve", commentId: args.comment_id, resolved: args.resolved };
  }
  let operationId = context.operationId;
  if (args.idempotency_key !== undefined) {
    if (typeof args.idempotency_key !== "string" || !args.idempotency_key.trim() || args.idempotency_key.length > 500) throw new Error("Invalid idempotency key");
    const seed = createHash("sha256").update(JSON.stringify([context.actorUserId,context.workspaceId,itemId,name,args.idempotency_key.trim()])).digest("hex");
    operationId = `${seed.slice(0,8)}-${seed.slice(8,12)}-4${seed.slice(13,16)}-8${seed.slice(17,20)}-${seed.slice(20,32)}`;
  }
  return mutateVaultItemComments({ ...location, operationId, mutation,
    actor: { userId: context.actorUserId, name: context.actorName, type: context.actorType ?? "external_agent" },
    beforeCommit: path => context.authorize(itemId, path, true) });
}
