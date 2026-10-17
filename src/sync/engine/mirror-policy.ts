/** Portable policy for an existing, live item after native path/binary work.
 * The adapter retains its writer lease and must CAS the captured file bytes.
 * Missing items, tombstones, active editors and conflicts are outside this slice.
 */
export interface MirrorObservation {
  localHash: string;
  baselineHash: string;
  remoteRevision: string;
  baselineRevision: string;
  refresh: boolean;
}
export type MirrorDisposition = "upload" | "pull" | "idle";

export function mirrorDisposition(input: MirrorObservation): MirrorDisposition {
  if (input.localHash !== input.baselineHash) return "upload";
  if (input.refresh || input.remoteRevision !== input.baselineRevision) return "pull";
  return "idle";
}

export function validateMirrorObservation(value: unknown): MirrorObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid mirror observation");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 5 ||
      ![v.localHash, v.baselineHash].every(x => typeof x === "string" && x.length === 64 && /^[a-f0-9]{64}$/.test(x)) ||
      ![v.remoteRevision, v.baselineRevision].every(x => typeof x === "string" && x.length > 0 && x.length <= 512 && !/[\x00-\x1f]/.test(x)) ||
      typeof v.refresh !== "boolean") throw Error("Invalid mirror observation");
  return { localHash: v.localHash as string, baselineHash: v.baselineHash as string,
    remoteRevision: v.remoteRevision as string, baselineRevision: v.baselineRevision as string, refresh: v.refresh };
}
