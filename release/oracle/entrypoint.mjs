import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node resolves imported modules through release symlinks, while argv retains
// the path used by systemd or the caller. Compare physical paths on both sides.
export function isEntrypoint(moduleUrl, argument = process.argv[1]) {
  if (!argument) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argument);
  } catch {
    return false; // Imports from stdin and eval do not have an executable path.
  }
}
