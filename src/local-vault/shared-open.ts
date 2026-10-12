import { VaultError, vaultRequest, type VaultFile } from "./bridge";
import { packIdentity } from "./pack";

export type NativeSharedSession = { sessionToken: string; path: string; hash: string; projectedHash?: string | null; acknowledgedRevision: string; journal: string | null; retiredReason: string | null; capabilities?: string[] };

/** Reread a same-identity file if sync or a CLI edit wins the read/open race. */
export async function openLocalSharedSession(
  itemId: string,
  initial: VaultFile,
  request: typeof vaultRequest = vaultRequest,
  unchangedRetryMs = 20_000,
): Promise<{ native: NativeSharedSession; file: VaultFile }> {
  let file = initial;
  const deadline = Date.now() + unchangedRetryMs;
  for (let attempt = 0; attempt < 16; attempt++) {
    try {
      const native = await request<NativeSharedSession>("collaborationOpen", { itemId, path: file.path, hash: file.hash });
      return { native, file };
    } catch (error) {
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
