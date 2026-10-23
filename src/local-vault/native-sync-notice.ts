export type NativeSyncNotice = { kind: "authentication" | "attention"; message: string };
const attentionMessage = "Sync needs attention. Your files are kept on this device.";
const knownMessages = new Set([
  "Some documents have conflicting changes. Both copies are retained.",
  "An attachment changed on another device. The local file is kept for resolution.",
  "A saved file move needs review. Its original command and local file are retained.",
  "A saved file move needs review. Its local file and server result are retained.",
  "A saved file move is waiting for its server receipt. Your file is kept on this device.",
  "A queued file update needs review before its path can change. Your file is kept on this device.",
  "Some files are temporarily unavailable or invalid. Other files continue syncing.",
  "A workspace folder could not be opened. Other files continue syncing.",
  "Sync is paused. Restart TextText to reconnect.",
  "Sync is paused. Repair the local file or reopen this workspace to retry.",
  "Conflicting edits were kept in this folder's recovery copies.",
  "Choose Review saved work in the File menu to connect this folder to your account.",
  "Return to the original account to continue this folder's saved work.",
]);

/** Display-only account status. It never authorizes, signs out or retries work. */
export function nativeSyncNotice(connection: unknown): NativeSyncNotice | null {
  if (!connection || typeof connection !== "object") return null;
  const value = connection as Record<string, unknown>;
  if (value.available !== true) return null;
  if (value.authenticationRequired === true) {
    return { kind: "authentication", message: "Sign in again to resume syncing. Your files are kept on this device." };
  }
  const conflicts = value.hasConflicts === true;
  if (!conflicts && (value.connecting === true || value.onlineReady === true)) return null;
  const message = typeof value.message === "string" ? value.message : "";
  if (!conflicts && value.onlineReady !== false && !message.trim()) return null;
  return { kind: "attention", message: knownMessages.has(message) ? message : attentionMessage };
}
