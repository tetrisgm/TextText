/** Portable folder dispatch only. Adapters retain owner/tree/wire checks,
 * durable requests, OS primitives and authenticated receipt adoption. */
export interface MirrorFolderObservation {
  phase: "idle" | "candidate" | "pending";
  capabilityAvailable: boolean;
  topologyMatches: boolean;
  changesContained: boolean;
  /** Only barriers enforced by the originating native branch are supplied.
   * These names do not assert cross-platform equivalence of private journals. */
  barriers: Array<"document" | "binary" | "savedRename" | "pull">;
}
export interface MirrorFolderDecision {
  action: "none" | "hold" | "stage-new" | "replay-existing";
}
const fields = ["phase", "capabilityAvailable", "topologyMatches", "changesContained", "barriers"];
const lanes = ["document", "binary", "savedRename", "pull"];
export function validateMirrorFolderObservation(input: unknown): MirrorFolderObservation {
  const invalid = (): never => { throw Error("Invalid folder observation"); };
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  if (Reflect.ownKeys(value).length !== fields.length || fields.some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !descriptor || !("value" in descriptor);
  })) return invalid();
  if (!["idle", "candidate", "pending"].includes(value.phase as string) ||
      ["capabilityAvailable", "topologyMatches", "changesContained"].some(key => typeof value[key] !== "boolean") ||
      !Array.isArray(value.barriers) || value.barriers.length > lanes.length ||
      Reflect.ownKeys(value.barriers).length !== value.barriers.length + 1 ||
      Array.from({ length: value.barriers.length }, (_, index) => Object.getOwnPropertyDescriptor(value.barriers, String(index)))
        .some(descriptor => !descriptor || !("value" in descriptor)) ||
      value.barriers.some(lane => typeof lane !== "string" || !lanes.includes(lane)) ||
      new Set(value.barriers).size !== value.barriers.length) return invalid();
  return { phase: value.phase as MirrorFolderObservation["phase"],
    capabilityAvailable: value.capabilityAvailable as boolean,
    topologyMatches: value.topologyMatches as boolean, changesContained: value.changesContained as boolean,
    barriers: [...value.barriers] as MirrorFolderObservation["barriers"] };
}
export function mirrorFolder(input: MirrorFolderObservation): MirrorFolderDecision {
  const value = validateMirrorFolderObservation(input);
  if (value.phase === "idle") return { action: "none" };
  if (!value.capabilityAvailable || value.barriers.length > 0) return { action: "hold" };
  // A retained command may already have committed remotely. Fresh topology
  // cannot revoke immutable receipt replay after an ambiguous/lost reply.
  if (value.phase === "pending") return { action: "replay-existing" };
  return { action: value.topologyMatches && value.changesContained ? "stage-new" : "hold" };
}
