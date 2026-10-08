import { createHash } from "node:crypto";
import { deleteVaultTextpack, moveVaultTextpack, restoreVaultTextpack } from "@/lib/store";
import type { VaultMutationContext } from "./vault-mutations";

/** Explicit source path makes a lost acknowledgement retry independent of today's location. */
export async function organizeVaultItem(name: "move_item" | "delete_item" | "restore_item", args: Record<string, unknown>, context: VaultMutationContext) {
  const allowed = ["id", "path", "if_match_hash", "idempotency_key", ...(name !== "delete_item" ? ["folder_path"] : [])];
  if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error("Unsupported file organization fields.");
  const { id, path, if_match_hash: revision, idempotency_key: key } = args;
  if (typeof id !== "string" || typeof path !== "string" || typeof revision !== "string" || typeof key !== "string" || !key.trim() || key.length > 500 || path.length > 4096) throw new Error("Read the file and provide its path, hash and a stable idempotency key.");
  if (!path.endsWith(".textpack") || path.split("/").some(part => !part || part === "." || part === "..") || /[\\\x00-\x1f]/.test(path)) throw new Error("Invalid file path.");
  let destination = path;
  if (name === "move_item" || name === "restore_item" && args.folder_path !== undefined) {
    const folder = args.folder_path;
    if (typeof folder !== "string" || folder.length > 4096 || folder !== "" && folder.split("/").some(part => !part || part === "." || part === "..") || /[\\\x00-\x1f]/.test(folder)) throw new Error("Invalid destination folder.");
    destination = `${folder ? `${folder}/` : ""}${path.slice(path.lastIndexOf("/") + 1)}`;
  }
  const authorize = async () => {
    await context.authorize(id, path, false);
    if (name !== "delete_item") await context.authorize(id, destination, true);
  };
  await authorize();
  const input = { receiptOnly: context.receiptOnly, root: context.root, workspaceId: context.workspaceId, itemId: id, basePath: path, baseRevision: revision,
    operationId: createHash("sha256").update(JSON.stringify([context.actorUserId, name, key])).digest("hex"),
    actorUserId: context.actorUserId, actorType: context.actorType ?? "external_agent" as const,
    beforeCommit: authorize };
  const result = name === "move_item" ? await moveVaultTextpack({ ...input, relativePath: destination })
    : name === "restore_item" ? await restoreVaultTextpack({ ...input, relativePath: destination }) : await deleteVaultTextpack(input);
  if (result.status === "conflict") throw new Error("The file changed. Read it again before organizing it.");
  return { ...result, ...(name === "delete_item" ? { recoveryRetained: true } : {}) };
}
