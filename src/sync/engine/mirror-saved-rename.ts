/** Portable eligibility only. Native owners retain immutable requests, verify
 * receipts, archive stopped records, and revalidate observations before commit. */
export interface MirrorSavedRenameObservation {
  phase: "none" | "pending" | "terminal-rejected" | "stopped";
  savedSource: string | null;
  savedDestination: string | null;
  savedLifecycle: string | null;
  stoppedLocalPath: string | null;
  stoppedRemotePath: string | null;
  stoppedLocalLifecycle: string | null;
  stoppedRemoteLifecycle: string | null;
  localPath: string | null;
  remotePath: string | null;
  baselinePath: string | null;
  checkpointPath: string | null;
  localLifecycle: string | null;
  remoteLifecycle: string | null;
  remoteDeleted: boolean;
  localUnique: boolean;
  checkpointReady: boolean;
  retired: boolean;
  scopeVerified: boolean;
  remoteAuthoritative: boolean;
  canOrganize: boolean;
  recoveryBlocked: boolean;
  terminalProofValid: boolean;
}
export interface MirrorSavedRenameDecision {
  action: "hold" | "replay-saved" | "review" | "suppress-stopped" | "stage-new";
}
const paths = ["savedSource", "savedDestination", "stoppedLocalPath", "stoppedRemotePath", "localPath", "remotePath", "baselinePath", "checkpointPath"] as const;
const generations = ["savedLifecycle", "stoppedLocalLifecycle", "stoppedRemoteLifecycle", "localLifecycle", "remoteLifecycle"] as const;
const flags = ["remoteDeleted", "localUnique", "checkpointReady", "retired", "scopeVerified", "remoteAuthoritative", "canOrganize", "recoveryBlocked", "terminalProofValid"] as const;
const fields = ["phase", ...paths, ...generations, ...flags];
function path(value: unknown): boolean {
  return value === null || typeof value === "string" && value.length > 0 && value.length <= 1024 &&
    !/[\\:\x00-\x1f\x7f]/.test(value) && /\.textpack$/i.test(value) &&
    value.split("/").every(part => part !== "" && part !== "." && part !== "..") &&
    !Array.from(value).some(character => { const scalar = character.codePointAt(0)!; return scalar >= 0xd800 && scalar <= 0xdfff; });
}
export function validateMirrorSavedRenameObservation(input: unknown): MirrorSavedRenameObservation {
  const invalid = (): never => { throw Error("Invalid saved rename observation"); };
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  if (Reflect.ownKeys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key)) ||
      !["none", "pending", "terminal-rejected", "stopped"].includes(value.phase as string) ||
      paths.some(key => !path(value[key])) ||
      generations.some(key => value[key] !== null && (typeof value[key] !== "string" || value[key].length === 0 || value[key].length > 512 || /[\x00-\x1f\x7f]/.test(value[key]))) ||
      flags.some(key => typeof value[key] !== "boolean")) return invalid();
  const stopped = [value.stoppedLocalPath, value.stoppedRemotePath, value.stoppedLocalLifecycle, value.stoppedRemoteLifecycle];
  if (value.phase === "none" ? value.savedSource !== null || value.savedDestination !== null || value.savedLifecycle !== null : value.savedSource === null || value.savedDestination === null) return invalid();
  if (value.phase === "stopped" ? stopped.some(item => item === null) || value.savedLifecycle === null || value.stoppedLocalLifecycle !== value.savedLifecycle || value.stoppedRemoteLifecycle !== value.savedLifecycle : stopped.some(item => item !== null)) return invalid();
  if (value.phase !== "none" && value.savedSource === value.savedDestination) return invalid();
  if (value.terminalProofValid !== (value.phase === "terminal-rejected" || value.phase === "stopped") ||
      value.remoteDeleted && value.remotePath === null || value.checkpointReady && value.checkpointPath === null) return invalid();
  return Object.fromEntries(fields.map(key => [key, value[key]])) as unknown as MirrorSavedRenameObservation;
}
export function mirrorSavedRename(input: MirrorSavedRenameObservation): MirrorSavedRenameDecision {
  const v = validateMirrorSavedRenameObservation(input);
  const result = (action: MirrorSavedRenameDecision["action"]): MirrorSavedRenameDecision => ({ action });
  if (!v.scopeVerified || !v.remoteAuthoritative || v.recoveryBlocked || !v.localUnique) return result("hold");
  if (v.phase === "terminal-rejected") return result("review");
  if (v.phase === "stopped") {
    const sameGenerations = v.localLifecycle === v.stoppedLocalLifecycle && v.remoteLifecycle === v.stoppedRemoteLifecycle;
    if (!v.remoteDeleted && sameGenerations && v.localPath === v.stoppedLocalPath && v.remotePath === v.stoppedRemotePath) return result("suppress-stopped");
    if (!v.remoteDeleted && sameGenerations && v.localPath !== null && v.localPath !== v.stoppedLocalPath && v.localPath !== v.remotePath && v.remotePath === v.stoppedRemotePath &&
        v.localLifecycle === v.remoteLifecycle && v.checkpointReady && !v.retired && v.checkpointPath === v.localPath && v.canOrganize) return result("stage-new");
    return result("review");
  }
  if (v.remoteDeleted) return result(v.phase === "pending" ? "review" : "hold");
  if (v.localPath === null || v.remotePath === null) return result("hold");
  if (v.phase === "pending" && (v.savedLifecycle === null || v.localLifecycle !== null && v.localLifecycle !== v.savedLifecycle || v.remoteLifecycle !== null && v.remoteLifecycle !== v.savedLifecycle)) return result("review");
  if (!v.canOrganize || !v.checkpointReady || v.retired || v.checkpointPath !== v.localPath ||
      v.localLifecycle === null || v.remoteLifecycle === null || v.localLifecycle !== v.remoteLifecycle) return result("hold");
  if (v.phase === "pending") return result("replay-saved");
  if (v.baselinePath === null) return result("hold");
  if (v.localPath !== v.baselinePath && v.remotePath === v.baselinePath) return result("stage-new");
  if (v.localPath !== v.baselinePath && v.remotePath !== v.baselinePath && v.localPath !== v.remotePath) return result("review");
  return result("hold");
}
