/** Portable tombstone disposition only. Native hosts must capture actual file
 * identity, retained baseline generation and authoritative manifest facts, then
 * revalidate them after awaiting policy before any file/history/journal change.
 * This module neither removes content nor authorizes metadata acknowledgement. */
export interface MirrorTombstoneObservation {
  remotePresent: boolean;
  remoteDeleted: boolean;
  remoteAuthoritative: boolean;
  editorOwned: boolean;
  recoveryBlocked: boolean;
  localPresent: boolean;
  localUnique: boolean;
  localIdentityVerified: boolean;
  localHash: string | null;
  baselineHash: string | null;
  localPath: string | null;
  baselinePath: string | null;
  remotePath: string | null;
  baselineRevision: string | null;
  remoteRevision: string | null;
  /** Actual retained native generation associated with the baseline, not a
   * collaboration epoch or an inferred equality of missing markers. */
  localLifecycle: string | null;
  remoteLifecycle: string | null;
}
export interface MirrorTombstoneDecision {
  action: "defer" | "no-local" | "remove-local" | "retain-conflict";
}
const flags = ["remotePresent", "remoteDeleted", "remoteAuthoritative", "editorOwned", "recoveryBlocked", "localPresent", "localUnique", "localIdentityVerified"] as const;
const hashes = ["localHash", "baselineHash"] as const;
const paths = ["localPath", "baselinePath", "remotePath"] as const;
const texts = ["baselineRevision", "remoteRevision", "localLifecycle", "remoteLifecycle"] as const;
const fields = [...flags, ...hashes, ...paths, ...texts];
const text = (value: unknown) => value === null || typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
function packPath(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 ||
      /[\\:\x00-\x1f\x7f]/.test(value) || !/\.textpack$/i.test(value) ||
      value.split("/").some(part => part === "" || part === "." || part === "..")) return false;
  return !Array.from(value).some(character => { const scalar = character.codePointAt(0)!; return scalar >= 0xd800 && scalar <= 0xdfff; });
}
export function validateMirrorTombstoneObservation(value: unknown): MirrorTombstoneObservation {
  const invalid = (): never => { throw Error("Invalid mirror tombstone observation"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>, keys = Reflect.ownKeys(v);
  if (keys.length !== fields.length || fields.some(key => !Object.hasOwn(v, key)) ||
      flags.some(key => typeof v[key] !== "boolean") ||
      hashes.some(key => v[key] !== null && (typeof v[key] !== "string" || (v[key] as string).length !== 64 || !/^[a-f0-9]{64}$/.test(v[key] as string))) ||
      paths.some(key => !packPath(v[key])) || texts.some(key => !text(v[key]))) return invalid();
  const baseline = [v.baselineHash, v.baselinePath, v.baselineRevision];
  if (!(baseline.every(x => x === null) || baseline.every(x => x !== null)) ||
      (v.baselineHash === null && v.localLifecycle !== null) ||
      (v.localPresent ? v.localHash === null || v.localPath === null : v.localHash !== null || v.localPath !== null) ||
      (v.remotePresent ? v.remotePath === null || v.remoteRevision === null :
        v.remotePath !== null || v.remoteRevision !== null || v.remoteLifecycle !== null || v.remoteDeleted || v.remoteAuthoritative)) return invalid();
  return Object.fromEntries(fields.map(key => [key, v[key]])) as unknown as MirrorTombstoneObservation;
}
export function mirrorTombstone(input: MirrorTombstoneObservation): MirrorTombstoneDecision {
  const v = validateMirrorTombstoneObservation(input);
  if (v.editorOwned || v.recoveryBlocked || !v.remotePresent || !v.remoteDeleted || !v.remoteAuthoritative) return { action: "defer" };
  // No file means no content mutation. This is not permission to clear a
  // baseline, intent, pending operation, or conflict record.
  if (!v.localPresent) return { action: "no-local" };
  if (!v.localUnique || !v.localIdentityVerified) return { action: "defer" };
  const sameGeneration = v.localLifecycle !== null && v.remoteLifecycle !== null && v.localLifecycle === v.remoteLifecycle;
  return { action: sameGeneration && v.baselineHash !== null && v.localHash === v.baselineHash &&
    v.baselineRevision === v.remoteRevision && v.localPath === v.baselinePath && v.baselinePath === v.remotePath
    ? "remove-local" : "retain-conflict" };
}
