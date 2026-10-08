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
