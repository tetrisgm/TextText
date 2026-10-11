import type { VaultFile } from "./bridge";
import { packIdentity } from "./pack";

/** Refresh archive assets without replacing a mounted Yjs editor or its text base. */
export function refreshBinaryOnlyFile(current: VaultFile, fresh: VaultFile, itemId: string, requireSameText: boolean): VaultFile | null {
  if (fresh.path !== current.path || packIdentity(fresh.markdown) !== itemId) return null;
  const sameText = current.markdown === fresh.markdown && current.documentJSON === fresh.documentJSON &&
    current.templateJSON === fresh.templateJSON && current.templateAuthoringSourceJSON === fresh.templateAuthoringSourceJSON;
  if (requireSameText && !sameText) return null;
  return { ...current, ...(sameText ? { hash: fresh.hash } : {}), assets: fresh.assets };
}
