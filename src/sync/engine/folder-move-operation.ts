import * as fs from "node:fs/promises";
import path from "node:path";
import { snapshotFolderTree, verifyFolderParents, assertFolderDestinationAvailable } from "./folder-move-filesystem";
import type { planFolderMove } from "./folder-move-plan";
export interface FolderMoveIntent {
 kind: "move_folder"; workspaceId: string; operationId: string; requestHash: string;
 actorUserId: string; actorType: "human" | "external_agent";
 plan: ReturnType<typeof planFolderMove>; treeHash: string; treeIdentity: string;
 manifest: { folders: string[]; items: { itemId: string; relativePath: string; revision: string }[] };
}
export interface FolderMoveOperationContext {
 workspace: string; pendingDirectory: string;
 metadata(intent: FolderMoveIntent, phase: "reserve" | "complete" | "abort"): Promise<void>;
 /** Update derived item paths and emit the durable audited receipt. Called
  * after metadata completion; replay must be idempotent. */
 finish(intent: FolderMoveIntent): Promise<void>;
 sync(directory: string): Promise<void>;
}
async function exists(file: string) {try {await fs.lstat(file);return true;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}}
/** Requires the caller's exclusive workspace lock. The intent already exists
 * durably before reserve, so recovery can finish every committed reservation.
 * No intermediate per-item paths are exposed to an engine reader. */
export async function applyFolderMoveIntent(intent: FolderMoveIntent, context: FolderMoveOperationContext) {
 const source=await verifyFolderParents(context.workspace,intent.plan.source);
 const destination=await verifyFolderParents(context.workspace,intent.plan.destination);
 const staged=path.join(context.pendingDirectory,"tree");
 let hasSource=await exists(source),hasStaged=await exists(staged),hasDestination=await exists(destination);
 if(hasStaged&&hasSource)throw Error("Folder move source was replaced; both copies are retained");
 if(hasStaged&&hasDestination)throw Error("Folder move destination is occupied; staged files are retained");
 if(!hasStaged&&!hasSource&&hasDestination){
  if((await snapshotFolderTree(destination)).hash!==intent.treeHash)throw Error("Moved folder changed before metadata recovery");
 }else if(!hasStaged&&hasSource){
  if(hasDestination)throw Error("Folder destination is occupied");
  if((await snapshotFolderTree(source)).hash!==intent.treeHash)throw Error("Folder contents changed before the move");
 }else if(!hasStaged)throw Error("Folder move source is unavailable");
 await context.metadata(intent,"reserve");
 if(!hasStaged&&hasSource){
  // Final source check follows the awaited metadata transaction.
  if((await snapshotFolderTree(source)).hash!==intent.treeHash){await context.metadata(intent,"abort");throw Error("Folder contents changed before the move");}
  await assertFolderDestinationAvailable(destination);
  await fs.rename(source,staged);await context.sync(path.dirname(source));await context.sync(context.pendingDirectory);
  hasSource=false;hasStaged=true;
 }
 if(hasStaged){
  if((await snapshotFolderTree(staged)).hash!==intent.treeHash){
   // Never overwrite a file/folder created at the previous source path.
   if(!(await exists(source))){await fs.rename(staged,source);await context.sync(path.dirname(source));await context.sync(context.pendingDirectory);await context.metadata(intent,"abort");}
   throw Error("Folder changed during move; content was preserved");
  }
  await assertFolderDestinationAvailable(destination);
  await fs.rename(staged,destination);await context.sync(path.dirname(destination));await context.sync(context.pendingDirectory);
  hasDestination=true;
 }
 if(!hasDestination)throw Error("Folder move destination unavailable");
 await context.metadata(intent,"complete");
 await context.finish(intent);
}
