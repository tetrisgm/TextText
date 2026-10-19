import { isLocalHandoffCapability, type LocalHandoffCapability } from "./local-handoff-capability";
import { VaultError, vaultRequest, type VaultFile } from "./bridge";
import { packIdentity } from "./pack";

export type NativeSharedSession = { localHandoff?: LocalHandoffCapability; sessionToken: string; path: string; hash: string; projectedHash?: string | null; acknowledgedRevision: string; journal: string | null; retiredReason: string | null; capabilities?: string[] };

/** Created only from a certified native rejection of a requested handoff.
 * A timeout, generic busy error or missing reply never establishes this proof. */
export class HandoffNotOpenedError extends VaultError {
  constructor(readonly itemId: string, readonly requestedPath: string, readonly requestedHash: string) {
    super("This note has not connected yet. Its local draft is kept.", "handoff_not_open");
  }
  matches(itemId: string, file: VaultFile) {
    return this.itemId === itemId && this.requestedPath === file.path && this.requestedHash === file.hash && packIdentity(file.markdown) === itemId;
  }
}

/** Reread a same-identity file if sync or a CLI edit wins the read/open race. */
export async function openLocalSharedSession(
  itemId: string,
  initial: VaultFile,
  request: typeof vaultRequest = vaultRequest,
  unchangedRetryMs = 20_000,
  localHandoff?: LocalHandoffCapability,
  certifiedRetryMs = 1_000,
  assertHandoffCurrent?: () => void,
): Promise<{ native: NativeSharedSession; file: VaultFile }> {
  if (localHandoff !== undefined && !isLocalHandoffCapability(localHandoff)) throw new VaultError("This recovery format is not supported.", "handoff_unverified");
  let file = initial;
  const deadline = Date.now() + unchangedRetryMs;
  const certifiedDeadline = Date.now() + certifiedRetryMs;
  let certifiedRetries = 0;
  for (let attempt = 0; attempt < 16; attempt++) {
    if (localHandoff) assertHandoffCurrent?.();
    try {
      const native = await request<NativeSharedSession>("collaborationOpen", { itemId, path: file.path, hash: file.hash, ...(localHandoff ? { localHandoffVersion: 1 } : {}) });
      if (localHandoff) assertHandoffCurrent?.();
      if (localHandoff && !isLocalHandoffCapability(native.localHandoff)) throw new VaultError("The shared editor could not verify its recovery format. Keep this document open.", "handoff_unverified");
      return { native, file };
    } catch (error) {
      if (localHandoff) assertHandoffCurrent?.();
      if (localHandoff && error instanceof VaultError && error.code === "handoff_not_open" && packIdentity(file.markdown) === itemId) {
        if (certifiedRetries < 3 && attempt < 15 && Date.now() < certifiedDeadline) {
          await new Promise(resolve => setTimeout(resolve, Math.min(100 * 2 ** certifiedRetries++, certifiedDeadline - Date.now())));
          assertHandoffCurrent?.();
          continue;
        }
        throw new HandoffNotOpenedError(itemId, file.path, file.hash);
      }
      if (!(error instanceof VaultError) || error.code !== "local_changed" || attempt === 15) throw error;
      const fresh = await request<VaultFile>("read", { path: error.path ?? file.path });
      if (packIdentity(fresh.markdown) !== itemId) throw error;
      // Native sync can update its baseline just after the WebView read, with
      // identical file bytes. Bound this retry; a real mismatch still fails.
      if (fresh.hash === file.hash) {
        if (Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(2_000, 250 * 2 ** Math.min(attempt, 3), deadline - Date.now())));
      }
      file = fresh;
    }
  }
  throw new Error("Could not reopen the shared file.");
}
