// The one module allowed to touch node:crypto. markdown-files.ts imports the
// hash from here so its render/parse logic stays a pure string transform; if
// markdown-files ever needs to run in a client bundle, break this import and
// thread a hashFor callback through renderFolderManifest instead.
import { createHash } from "node:crypto";

/** sha256 hex of a file's exact text, the sync client's change detector. */
export function markdownFileHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
