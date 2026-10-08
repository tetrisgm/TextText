import { z } from "zod";
import { folderMovePlanHash, type planFolderMove } from "@/sync/engine/folder-move-plan";
import type { FrozenFolderMovePreview } from "@/lib/ai/write-proposal-preview";

const text = z.string().min(1).max(1000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const role = z.enum(["viewer", "commenter", "editor"]);
const grant = z.object({ id:text,path:text,signature:text,email:text,role }).strict();
const planSchema = z.object({
  source:text,destination:text,manifestRevision:hash,grantsFingerprint:hash,
  folders:z.array(z.object({from:text,to:text}).strict()),
  items:z.array(z.object({itemId:text,relativePath:text,revision:hash,destination:text,lifecycle:text.optional(),restoreFromRevision:hash.optional()}).strict()),
  movedGrants:z.array(grant.extend({destination:text}).strict()),
  preserveInherited:z.array(grant.extend({destination:text}).strict()),
  addedAccess:z.array(z.object({email:text,role,via:text}).strict()),
}).strict();
const reviewSchema = z.object({kind:z.literal("folder_move"),tool:z.literal("move_folder_tree"),plan:planSchema,reviewedPlanHash:hash}).strict();

/** Clone the authoritative preview so later caller edits cannot alter what is
 * stored and shown. This module is server-only; UI imports only its data type. */
export function freezeFolderMoveReview(plan: ReturnType<typeof planFolderMove>): FrozenFolderMovePreview {
  return validateFolderMoveReview({kind:"folder_move",tool:"move_folder_tree",plan:structuredClone(plan),reviewedPlanHash:folderMovePlanHash(plan)}, {source:plan.source,destination:plan.destination});
}

/** Approval accepts only the stored review and original requested paths. The
 * database reservation still recomputes files and grants at execution. */
export function validateFolderMoveReview(value: unknown, requested: {source:string;destination:string}): FrozenFolderMovePreview {
  const review = reviewSchema.parse(value);
  if (review.plan.source !== requested.source || review.plan.destination !== requested.destination || folderMovePlanHash(review.plan) !== review.reviewedPlanHash) {
    throw new Error("Reviewed folder move changed");
  }
  return review;
}
