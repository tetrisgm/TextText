/** Typed native classification only. Never infer it from exception text or numeric codes. */
const checkpointFailureKinds = [
  "shared-invalid", "shared-session", "shared-generation", "shared-protected", "shared-interrupted", "shared-account",
  "sync-busy", "sync-changed", "sync-conflict", "sync-response", "sync-binding", "sync-identity", "sync-http",
  "replacement-space", "replacement-review", "replacement-unsupported", "replacement-record",
  "document-path", "document-changed", "document-size", "document-identity",
  "ownership-adoption", "ownership-account", "ownership-future", "profile", "recovery-record",
  "filesystem-missing", "filesystem-permission", "filesystem-space", "filesystem-readonly", "filesystem-other", "cancelled", "unknown",
] as const;
export type CheckpointFailureKind = typeof checkpointFailureKinds[number];
const safeFailureKinds = new Set<string>(checkpointFailureKinds);
export function readCheckpointFailureKind(error: unknown): CheckpointFailureKind | undefined {
  const value = ownData(error, "checkpointFailureKind");
  return typeof value === "string" && safeFailureKinds.has(value) ? value as CheckpointFailureKind : undefined;
}

/** Exportable checkpoint context, never the raw exception or request. */
export type CheckpointFailureDiagnostic = Readonly<{
  version: 1;
  code: string;
  message: string;
  checkpointFailureKind?: CheckpointFailureKind;
  journalGeneration: number | null;
  epoch: number | null;
  seq: number | null;
  pendingCount: number | null;
  hasBatch: boolean;
  unqueuedDirty: boolean;
  clean: boolean;
}>;
export type CheckpointFailureContext = Pick<CheckpointFailureDiagnostic,
  "journalGeneration" | "epoch" | "seq" | "pendingCount" | "hasBatch" | "unqueuedDirty" | "clean">;

// Exact product literals only. A dynamic NSError/URL/path/credential-bearing
// message must never become part of the downloaded diagnostic.
const safeMessages = new Set([
  "Invalid shared editing checkpoint. Your retained journal has not been removed.",
  "This shared editing session is no longer active. Reopen the document.",
  "A newer shared editing checkpoint is already saved.",
  "This document has protected shared edits.",
  "Shared editing materialization was interrupted.",
  "Saved edits need their original account or explicit recovery. They remain on this device.",
  "This shared editing session has closed. Your recovery journal is kept.",
  "The local shared file session has closed. Your journal is kept.",
  "The file changed outside shared editing.",
  "The file changed before shared editing opened.",
  "This account changed. Your saved work remains on this device.",
  "Return to the original account to continue this window's saved work.",
]);
const safeCodes = new Set(["local_changed", "session_closed", "account_changed", "cancelled", "invalid_request", "busy", "unauthorized"]);
function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  try { const field = Object.getOwnPropertyDescriptor(value, key); return field && "value" in field ? field.value : undefined; }
  catch { return undefined; }
}
function statusCode(value: unknown): string | null {
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : value;
  return typeof text === "string" && /^[45][0-9]{2}$/.test(text) ? text : null;
}
function scalar(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function checkpointFailureDiagnostic(error: unknown, context: CheckpointFailureContext): CheckpointFailureDiagnostic {
  const code = ownData(error, "code"), message = ownData(error, "message"), kind = readCheckpointFailureKind(error);
  return Object.freeze({
    version: 1,
    ...(kind === undefined ? {} : {checkpointFailureKind: kind}),
    code: typeof code === "string" && safeCodes.has(code) ? code : statusCode(code) ?? statusCode(ownData(error, "status")) ?? "unknown",
    message: typeof message === "string" && safeMessages.has(message) ? message : "Details withheld.",
    journalGeneration: scalar(context.journalGeneration), epoch: scalar(context.epoch), seq: scalar(context.seq), pendingCount: scalar(context.pendingCount),
    hasBatch: context.hasBatch === true, unqueuedDirty: context.unqueuedDirty === true, clean: context.clean === true,
  });
}
