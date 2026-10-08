import { createHash } from "node:crypto";
import { getBlogEditRecord, getUserIdBySub, moveVaultFolder, previewVaultFolderMove } from "@/lib/store";
import { validateFolderMoveReview } from "./folder-move-review";
import type { FrozenFolderMovePreview } from "@/lib/ai/write-proposal-preview";

type Actor = { sub: string; userId: string | null; handle: string; receiptOnly?: boolean; actorType?: "human" | "ai" | "external_agent" };
export type ApprovedFolderMove = { review: FrozenFolderMovePreview; accessAcknowledged: boolean };

async function commandLocation(actor: Actor) {
  const root = process.env.TEXTTEXT_VAULT_ROOT;
  if (!root || !actor.userId) throw new Error("File workspace storage is not available.");
  const workspace = await getBlogEditRecord(actor.handle);
  const authorize = async () => {
    const [userId, current] = await Promise.all([getUserIdBySub(actor.sub), getBlogEditRecord(actor.handle)]);
    if (userId !== actor.userId || !current || current.id !== workspace?.id || current.ownerId !== userId) {
      throw new Error("Only the current workspace owner can move folders.");
    }
  };
  await authorize();
  return { root, workspaceId: workspace!.id, actorUserId: actor.userId, authorize };
}

export async function previewFolderMoveCommand(actor: Actor, requested: { source: string; destination: string }) {
  return previewVaultFolderMove({ ...await commandLocation(actor), ...requested });
}

/** Invoked only by the durable proposal decision service. A tool request never
 * supplies this review or acknowledgement as command arguments. */
export async function executeApprovedFolderMove(actor: Actor, args: Record<string, unknown>, approved: ApprovedFolderMove | undefined) {
  if (!approved || typeof args.source_path !== "string" || typeof args.destination_path !== "string" || typeof args.idempotency_key !== "string") {
    throw new Error("A stored owner-approved folder review is required.");
  }
  const review = validateFolderMoveReview(approved.review, { source: args.source_path, destination: args.destination_path });
  const location = await commandLocation(actor);
  return moveVaultFolder({ ...location, ...review,
    operationId: createHash("sha256").update(`${actor.userId}:move_folder_tree:${args.idempotency_key}`).digest("hex"),
    actorType: actor.actorType === "human" ? "human" : "external_agent", reviewedAccessExpansion: approved.accessAcknowledged,
    receiptOnly: actor.receiptOnly,
  });
}
