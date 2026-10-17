/** Classifies restore boundaries only. Native hosts retain durable operations,
 * recovery files, editor leases and server compare-and-swap writes. */
export interface MirrorLifecycleObservation {
  remotePresent: boolean;
  remoteDeleted: boolean;
  remoteLifecycle: string | null;
  remoteRevision: string | null;
  editorOwned: boolean;
  baselineLifecycle: string | null;
  baselineRevision: string | null;
  pendingKind: "upload" | "rename" | "delete" | "conflict" | null;
  pendingLifecycle: string | null;
  pendingBaseRevision: string | null;
  pendingConflicted: boolean;
}
export interface MirrorLifecycleDecision {
  baseline: "keep" | "adopt" | "defer";
  pending: "none" | "keep" | "adopt" | "retire-delete" | "fence-edit" | "keep-fenced" | "defer";
}
const keys = ["remotePresent", "remoteDeleted", "remoteLifecycle", "remoteRevision", "editorOwned",
  "baselineLifecycle", "baselineRevision", "pendingKind", "pendingLifecycle", "pendingBaseRevision", "pendingConflicted"];
export function validateMirrorLifecycleObservation(value: unknown): MirrorLifecycleObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid mirror lifecycle observation");
  const v = value as Record<string, unknown>, own = Object.keys(v);
  const validText = (x: unknown) => x === null || typeof x === "string" && x.length > 0 && x.length <= 512 && !/[\x00-\x1f]/.test(x);
  if (own.length !== keys.length || own.some(key => !keys.includes(key)) ||
      ![v.remotePresent, v.remoteDeleted, v.editorOwned, v.pendingConflicted].every(x => typeof x === "boolean") ||
      ![v.remoteLifecycle, v.remoteRevision, v.baselineLifecycle, v.baselineRevision, v.pendingLifecycle, v.pendingBaseRevision].every(validText) ||
      ![null, "upload", "rename", "delete", "conflict"].includes(v.pendingKind as string | null) ||
      (v.pendingKind === null && (v.pendingLifecycle !== null || v.pendingBaseRevision !== null || v.pendingConflicted)) ||
      (v.pendingKind === "conflict" && !v.pendingConflicted) ||
      (v.remotePresent ? v.remoteRevision === null : v.remoteLifecycle !== null || v.remoteRevision !== null || v.remoteDeleted)) {
    throw Error("Invalid mirror lifecycle observation");
  }
  return Object.fromEntries(keys.map(key => [key, v[key]])) as unknown as MirrorLifecycleObservation;
}
export function mirrorLifecycle(input: MirrorLifecycleObservation): MirrorLifecycleDecision {
  const v = validateMirrorLifecycleObservation(input);
  if (!v.remotePresent || v.remoteDeleted || v.remoteLifecycle === null || v.editorOwned) return { baseline: "defer", pending: "defer" };
  const baseline = v.baselineLifecycle === null && v.baselineRevision === v.remoteRevision ? "adopt" : "keep";
  if (v.pendingKind === null) return { baseline, pending: "none" };
  if (v.pendingLifecycle === v.remoteLifecycle) return { baseline, pending: "keep" };
  // Adopting metadata never clears the existing native conflict fence.
  if (v.pendingLifecycle === null && v.pendingBaseRevision === v.remoteRevision) return { baseline, pending: "adopt" };
  return { baseline, pending: v.pendingKind === "delete" ? "retire-delete" : v.pendingConflicted ? "keep-fenced" : "fence-edit" };
}
