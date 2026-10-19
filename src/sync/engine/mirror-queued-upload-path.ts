/** Portable queued-upload path eligibility. Decisions do not acknowledge or
 * clear any command, intent or baseline, and do not authorize sending bytes.
 * Native owners must revalidate the captured account, payload identity/hash,
 * projection, journal, permissions and remote facts after awaiting this policy. */
export interface MirrorQueuedUploadPathObservation {
  pendingKind: "upload" | "rename" | "delete";
  pendingConflicted: boolean;
  pendingUnique: boolean;
  pendingPath: string;
  pendingBaseRevision: string | null;
  pendingLifecycle: string | null;
  baselinePath: string | null;
  baselineRevision: string | null;
  baselineLifecycle: string | null;
  remotePath: string | null;
  remoteRevision: string | null;
  remoteLifecycle: string | null;
  remoteDeleted: boolean;
  remoteAuthoritative: boolean;
  localPath: string | null;
  localUnique: boolean;
  localIdentityVerified: boolean;
  /** Actual captured staged bytes have the expected hash AND same item ID. */
  stagedPayloadVerified: boolean;
  editorOwned: boolean;
  recoveryBlocked: boolean;
  permitted: boolean;
  intentKind: "none" | "rename" | "delete" | "other";
  intentPath: string | null;
  intentDestination: string | null;
}
export interface MirrorQueuedUploadPathDecision {
  action: "defer" | "keep" | "reissue-at-remote-path";
}
const flags = ["pendingConflicted", "pendingUnique", "remoteDeleted", "remoteAuthoritative", "localUnique", "localIdentityVerified", "stagedPayloadVerified", "editorOwned", "recoveryBlocked", "permitted"] as const;
const paths = ["pendingPath", "baselinePath", "remotePath", "localPath", "intentPath", "intentDestination"] as const;
const texts = ["pendingBaseRevision", "pendingLifecycle", "baselineRevision", "baselineLifecycle", "remoteRevision", "remoteLifecycle"] as const;
const fields = ["pendingKind", "intentKind", ...flags, ...paths, ...texts];
const text = (v: unknown) => v === null || typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\x00-\x1f\x7f]/.test(v);
function path(v: unknown): boolean {
  return v === null || typeof v === "string" && v.length > 0 && v.length <= 1024 &&
    !/[\\:\x00-\x1f\x7f]/.test(v) && /\.textpack$/i.test(v) &&
    !v.split("/").some(part => !part || part === "." || part === "..") &&
    !Array.from(v).some(c => { const scalar = c.codePointAt(0)!; return scalar >= 0xd800 && scalar <= 0xdfff; });
}
export function validateMirrorQueuedUploadPathObservation(value: unknown): MirrorQueuedUploadPathObservation {
  const invalid = (): never => { throw Error("Invalid mirror queued upload path observation"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  if (Reflect.ownKeys(v).length !== fields.length || fields.some(k => !Object.hasOwn(v, k)) ||
      !["upload", "rename", "delete"].includes(v.pendingKind as string) ||
      !["none", "rename", "delete", "other"].includes(v.intentKind as string) ||
      flags.some(k => typeof v[k] !== "boolean") || paths.some(k => !path(v[k])) || texts.some(k => !text(v[k])) || v.pendingPath === null) return invalid();
  if ((v.baselinePath === null && (v.baselineRevision !== null || v.baselineLifecycle !== null)) ||
      (v.baselinePath !== null && v.baselineRevision === null) ||
      (v.remotePath === null && (v.remoteRevision !== null || v.remoteLifecycle !== null || v.remoteDeleted || v.remoteAuthoritative)) ||
      (v.remotePath !== null && v.remoteRevision === null) ||
      (v.localPath === null && (v.localUnique || v.localIdentityVerified)) ||
      (v.intentKind === "none" && (v.intentPath !== null || v.intentDestination !== null)) ||
      (v.intentKind === "rename" && (v.intentPath === null || v.intentDestination === null)) ||
      (v.intentKind === "delete" && (v.intentPath === null || v.intentDestination !== null))) return invalid();
  return Object.fromEntries(fields.map(k => [k, v[k]])) as unknown as MirrorQueuedUploadPathObservation;
}
export function mirrorQueuedUploadPath(input: MirrorQueuedUploadPathObservation): MirrorQueuedUploadPathDecision {
  const v = validateMirrorQueuedUploadPathObservation(input);
  const defer: MirrorQueuedUploadPathDecision = { action: "defer" };
  if (v.pendingKind !== "upload" || v.pendingConflicted || !v.pendingUnique || v.editorOwned || v.recoveryBlocked || !v.permitted ||
      !v.remoteAuthoritative || v.remoteDeleted || v.remotePath === null || v.baselinePath === null || v.localPath === null ||
      !v.localUnique || !v.localIdentityVerified || !v.stagedPayloadVerified) return defer;
  if (v.pendingBaseRevision === null || v.pendingBaseRevision !== v.baselineRevision || v.pendingBaseRevision !== v.remoteRevision ||
      v.pendingLifecycle === null || v.pendingLifecycle !== v.baselineLifecycle || v.pendingLifecycle !== v.remoteLifecycle) return defer;
  if (![v.pendingPath, v.remotePath].includes(v.localPath) || ![v.pendingPath, v.remotePath].includes(v.baselinePath)) return defer;
  if (v.intentKind !== "none" && !(v.intentKind === "rename" && v.intentPath === v.pendingPath &&
      v.intentDestination === v.remotePath && v.localPath === v.remotePath)) return defer;
  return { action: v.pendingPath === v.remotePath ? "keep" : "reissue-at-remote-path" };
}
