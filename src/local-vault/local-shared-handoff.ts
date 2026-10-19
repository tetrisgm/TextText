import type { DocumentSnapshot } from "@/lib/documents/model";
import type { FileCollaborationDurabilityResult } from "@/sync/engine/client";
import type { VaultFile } from "./bridge";

export type LocalHandoffCapture = { generation: number; document: DocumentSnapshot };
export type LocalHandoffScope = Pick<FileCollaborationDurabilityResult, "workspaceId" | "itemId" | "lifecycle">;
export type LocalSharedHandoffOptions<H> = {
  /** Must fence the captured account/root/owner and optional shared handle. */
  assertCurrent(handle?: H): void;
  capture(): LocalHandoffCapture;
  /** Synchronously stop future direct writes, then drain only the captured in-flight write. */
  pauseAndDrain(): Promise<{ file: VaultFile; base: DocumentSnapshot }>;
  /** Return the handle before awaiting readiness, including a possibly failed native open. */
  beginOpen(saved: { file: VaultFile; base: DocumentSnapshot }): { handle: H; ready: Promise<void> };
  scope(handle: H): LocalHandoffScope;
  /** Return the actual journal generation covering the merged edits, or null on refusal. */
  merge(handle: H, base: DocumentSnapshot, local: DocumentSnapshot): number | null;
  durability(handle: H): Promise<FileCollaborationDurabilityResult>;
  /** Synchronous same-view/writer ownership barrier; false leaves the draft retained. */
  atomicCommit(handle: H, expectedLocalGeneration: number): boolean;
  /** Clear only this exact draft generation after validating the actual shared receipt. */
  acknowledgeDraft(handle: H, localGeneration: number, receipt: FileCollaborationDurabilityResult): Promise<void>;
  /** Never resume the file writer or discard a possibly acquired lease here. */
  retain(error: unknown, handle?: H): void;
};
export type LocalSharedHandoffResult<H> =
  | { state: "shared"; handle: H }
  | { state: "retained"; handle?: H; error: unknown };

function capture(value: LocalHandoffCapture, minimum = 0): LocalHandoffCapture {
  if (!Number.isSafeInteger(value.generation) || value.generation < minimum) throw new Error("The local handoff generation changed.");
  // A later input must not mutate the already transferred baseline.
  return { generation: value.generation, document: structuredClone(value.document) };
}
function sameScope(left: LocalHandoffScope, right: LocalHandoffScope): boolean {
  return left.workspaceId === right.workspaceId && left.itemId === right.itemId && left.lifecycle === right.lifecycle;
}
function requireTarget(target: number | null, minimum = 1): number {
  if (!Number.isSafeInteger(target) || target === null || target < minimum) throw new Error("The shared handoff has no durable merge target.");
  return target;
}
function requireReceipt(receipt: FileCollaborationDurabilityResult, scope: LocalHandoffScope, minimum: number): void {
  if (receipt.outcome !== "durable" || !sameScope(receipt, scope) || !Number.isSafeInteger(receipt.generation) || receipt.generation < minimum) {
    throw new Error("The shared handoff has not durably saved this lifecycle.");
  }
}

/** Two bounded transfers; continuous typing cannot starve the synchronous view handoff. */
export async function handoffLocalToShared<H>(options: LocalSharedHandoffOptions<H>): Promise<LocalSharedHandoffResult<H>> {
  let handle: H | undefined;
  try {
    options.assertCurrent();
    const drained = await options.pauseAndDrain();
    options.assertCurrent();
    const saved = { file: { ...drained.file }, base: structuredClone(drained.base) };
    const opened = options.beginOpen(saved);
    handle = opened.handle;
    await opened.ready;
    options.assertCurrent(handle);
    const scope = { ...options.scope(handle) };
    if (![scope.workspaceId, scope.itemId, scope.lifecycle].every(value => typeof value === "string" && value.length > 0)) {
      throw new Error("The shared handoff has no current lifecycle.");
    }
    const first = capture(options.capture());
    const firstTarget = requireTarget(options.merge(handle, saved.base, first.document));
    options.assertCurrent(handle);
    const firstReceipt = await options.durability(handle);
    options.assertCurrent(handle);
    if (!sameScope(scope, options.scope(handle))) throw new Error("The shared handoff lifecycle changed.");
    requireReceipt(firstReceipt, scope, firstTarget);
    const firstSharedGeneration = firstReceipt.generation;

    const final = capture(options.capture(), first.generation);
    // No await between this final capture/merge and writer+view ownership switch.
    const finalTarget = requireTarget(options.merge(handle, first.document, final.document), firstTarget);
    options.assertCurrent(handle);
    if (!options.atomicCommit(handle, final.generation)) throw new Error("The local handoff was superseded.");
    options.assertCurrent(handle);
    const finalReceipt = await options.durability(handle);
    options.assertCurrent(handle);
    if (!sameScope(scope, options.scope(handle))) throw new Error("The shared handoff lifecycle changed.");
    requireReceipt(finalReceipt, scope, Math.max(finalTarget, firstSharedGeneration));
    await options.acknowledgeDraft(handle, final.generation, finalReceipt);
    options.assertCurrent(handle);
    return { state: "shared", handle };
  } catch (error) {
    options.retain(error, handle);
    return { state: "retained", ...(handle === undefined ? {} : { handle }), error };
  }
}
