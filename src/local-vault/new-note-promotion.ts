import type { VaultFile } from "./bridge";
import type { VaultCollaborationConfig } from "./CollaborativeVaultEditor";
import { packIdentity } from "./pack";

type PromotionOptions = {
  path: string;
  candidate: VaultCollaborationConfig;
  flush: () => Promise<boolean>;
  hasDraft: () => boolean;
  read: () => Promise<VaultFile>;
  config: () => Promise<VaultCollaborationConfig | null>;
};

/** Promote only bytes that have finished saving locally and are acknowledged by sync. */
export async function prepareSharedNote({ path, candidate, flush, hasDraft, read, config }: PromotionOptions) {
  if (!await flush() || hasDraft()) return null;
  const file = await read();
  if (file.path !== path || packIdentity(file.markdown) !== candidate.itemId) return null;
  const ready = await config();
  if (!ready || ready.itemId !== candidate.itemId || ready.workspaceId !== candidate.workspaceId ||
      ready.namespace !== candidate.namespace || ready.localFiles !== candidate.localFiles) return null;
  // An agent or Finder can still change the file between the readiness check
  // and the shared editor mount. Begin the shared session with this exact hash.
  const confirmed = await read();
  return confirmed.path === path && confirmed.hash === file.hash ? { config: ready, file: confirmed } : null;
}
