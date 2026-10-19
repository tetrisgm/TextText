/** Pure protected-projection path disposition. Native adapters retain durable
 * intent IDs, scoped authority, leases, exact file/checkpoint verification and
 * every mutation. This module alone does not complete the native path lane. */
import { legacyMirrorGeneration, sameMirrorGeneration, validateMirrorGenerationFacts, type MirrorGeneration } from "./mirror-generation";
export interface MirrorSharedPathObservation {
  generations?: Readonly<{ local: MirrorGeneration; remote: MirrorGeneration }>;
  protectedProjection: boolean;
  baselinePath: string | null;
  localPath: string | null;
  remotePath: string | null;
  checkpointPath: string | null;
  checkpointReady: boolean;
  checkpointRetired: boolean;
  localUnique: boolean;
  remoteDeleted: boolean;
  /** Actual retained file generation, not a checkpoint collaboration epoch.
   * Mac: state.lifecycles[item]; Windows: saved baseline lifecycle. */
  localLifecycle: string | null;
  remoteLifecycle: string | null;
  blocked: boolean;
  organizePermitted: boolean;
  /** Derived from actual retained evidence, never from a conflict flag alone.
   * Replay preserves an existing possibly committed intent; review keeps it. */
  pendingRename: "none" | "replay" | "review";
}
export interface MirrorSharedPathDecision {
  action: "hold" | "unchanged" | "follow-remote" | "announce-local" | "adopt-path";
}
const paths = ["baselinePath", "localPath", "remotePath", "checkpointPath"] as const;
const flags = ["protectedProjection", "checkpointReady", "checkpointRetired", "localUnique", "remoteDeleted", "blocked", "organizePermitted"] as const;
const generations = ["localLifecycle", "remoteLifecycle"] as const;
const fields = [...paths, ...flags, ...generations, "pendingRename"];
function relativePack(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 ||
      /[\\\x00-\x1f\x7f]/.test(value) || /^[A-Za-z]:/.test(value) || !/\.textpack$/i.test(value) ||
      value.split("/").some(part => part === "" || part === "." || part === "..")) return false;
  return !Array.from(value).some(character => { const scalar = character.codePointAt(0)!; return scalar >= 0xd800 && scalar <= 0xdfff; });
}
export function validateMirrorSharedPathObservation(value: unknown): MirrorSharedPathObservation {
  const invalid = () => { throw Error("Invalid mirror shared path observation"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  if (Object.hasOwn(v, "generations") && !("value" in Object.getOwnPropertyDescriptor(v, "generations")!)) return invalid();
  if (Object.keys(v).length !== fields.length + (Object.hasOwn(v, "generations") ? 1 : 0) || fields.some(key => !Object.hasOwn(v, key)) ||
      paths.some(key => !relativePack(v[key])) || flags.some(key => typeof v[key] !== "boolean") ||
      generations.some(key => v[key] !== null && (typeof v[key] !== "string" || (v[key] as string).length === 0 || (v[key] as string).length > 512 || /[\x00-\x1f\x7f]/.test(v[key] as string))) ||
      !["none", "replay", "review"].includes(v.pendingRename as string)) return invalid();
  const result = Object.fromEntries(fields.map(key => [key, v[key]])) as unknown as MirrorSharedPathObservation;
  if (Object.hasOwn(v, "generations")) result.generations = validateMirrorGenerationFacts(v.generations, { local: result.localLifecycle, remote: result.remoteLifecycle });
  return result;
}
export function mirrorSharedPath(input: MirrorSharedPathObservation): MirrorSharedPathDecision {
  const v = validateMirrorSharedPathObservation(input);
  // Ready Yjs checkpoints do not attest file restore generations. Unknown
  // includes missing baseline with no independently retained generation.
  const sameLifecycle = sameMirrorGeneration(v.generations?.local ?? legacyMirrorGeneration(v.localLifecycle), v.generations?.remote ?? legacyMirrorGeneration(v.remoteLifecycle));
  if (!sameLifecycle || !v.protectedProjection || !v.localUnique || !v.checkpointReady || v.checkpointRetired || v.blocked ||
      v.localPath === null || v.remotePath === null || v.remoteDeleted || v.checkpointPath !== v.localPath || v.pendingRename === "review") return { action: "hold" };
  if (v.pendingRename === "replay") {
    // Even matching visible paths do not acknowledge an ambiguously committed
    // retained operation. The native adapter must replay its SAME identity.
    return { action: v.baselinePath !== null && v.organizePermitted ? "announce-local" : "hold" };
  }
  if (v.localPath !== v.baselinePath && v.remotePath === v.baselinePath)
    return { action: v.organizePermitted ? "announce-local" : "hold" };
  // Diverging local and remote moves do not establish which path intent wins.
  // Retain both observations; do not silently move the protected local file.
  if (v.baselinePath !== null && v.localPath !== v.baselinePath && v.remotePath !== v.baselinePath && v.localPath !== v.remotePath) return { action: "hold" };
  // Missing baseline requires an independently retained generation (Mac state
  // lifecycle map); a checkpoint epoch or null==null never supplies that proof.
  if (v.localPath !== v.remotePath && v.remotePath !== v.baselinePath) return { action: "follow-remote" };
  // Existing Windows behavior. Mac integration needs its own RED before
  // adopting this disposition; the pure vectors do not authorize a mutation.
  if (v.baselinePath !== null && v.localPath !== v.baselinePath && v.localPath === v.remotePath)
    return { action: sameLifecycle ? "adopt-path" : "hold" };
  return { action: "unchanged" };
}
