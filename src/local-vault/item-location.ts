import type { VaultItem, VaultListing } from "./bridge";

/** A path is a location, never an identity. Ambiguous listings must not rebind
 * an editor to another file or silently pick one duplicate identity. */
export function locateVaultItem(itemId: string | null, listing: VaultListing): VaultItem | null {
  if (!itemId) return null;
  const matches = listing.items.filter(item => item.itemId === itemId);
  if (matches.length !== 1) return null;
  const match = matches[0];
  return listing.items.filter(item => item.path === match.path).length === 1 ? match : null;
}

/** Native listings identify rows from the sync manifest, which lags a filesystem
 * rename. When the listing has no row for this identity and none at the opened
 * path, ask the store where the identity lives now. Only an unidentified row at
 * that path may be adopted so another item's row and permission are never
 * borrowed; the listing row still decides what the caller may do there. */
export async function locateVaultItemOrResolve(itemId: string | null, openedPath: string, listing: VaultListing,
  resolve: (itemId: string) => Promise<{ path: string }>): Promise<VaultItem | null> {
  const located = locateVaultItem(itemId, listing);
  if (located || !itemId || listing.items.some(item => item.path === openedPath)) return located;
  const resolved = await resolve(itemId).catch(() => null);
  const rows = resolved ? listing.items.filter(item => item.path === resolved.path) : [];
  return rows.length === 1 && !rows[0].itemId ? rows[0] : null;
}
