import { VaultError, vaultRequest, type VaultFile } from "./bridge";
import { packIdentity } from "./pack";

export type NativeSharedSession = { sessionToken: string; path: string; hash: string; projectedHash?: string | null; acknowledgedRevision: string; journal: string | null; retiredReason: string | null; capabilities?: string[] };

/** Reread a same-identity file if sync or a CLI edit wins the read/open race. */
export async function openLocalSharedSession(
  itemId: string,
  initial: VaultFile,
  request: typeof vaultRequest = vaultRequest,
): Promise<{ native: NativeSharedSession; file: VaultFile }> {
  let file = initial;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const native = await request<NativeSharedSession>("collaborationOpen", { itemId, path: file.path, hash: file.hash });
      return { native, file };
    } catch (error) {
      if (!(error instanceof VaultError) || error.code !== "local_changed" || attempt === 2) throw error;
      const fresh = await request<VaultFile>("read", { path: error.path ?? file.path });
      if (packIdentity(fresh.markdown) !== itemId || fresh.hash === file.hash) throw error;
      file = fresh;
    }
  }
  throw new Error("Could not reopen the shared file.");
}
