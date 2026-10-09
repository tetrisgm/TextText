import type { VaultListing } from './bridge';
import { locateVaultItem } from './item-location';
import { canCreateInVaultFolder, type VaultAccess } from './shared-vaults';
export function listingCapabilities(listing: VaultListing | null, access: VaultAccess | null, native: boolean) {
  const explicit = typeof listing?.fullAccess === 'boolean';
  // Old local-only adapters have no permission metadata. New account adapters
  // always provide explicit false until their first authenticated manifest.
  const legacyLocal = native && !explicit;
  const full = explicit ? listing.fullAccess === true : legacyLocal || access?.fullAccess === true;
  const writeAll = explicit ? listing.canCreateContent === true : legacyLocal || Boolean(access?.fullAccess && access.canEditContent);
  return {
    fullAccess: full,
    manageFiles: full && writeAll,
    create(folder: string) {
      if (!explicit) return legacyLocal || canCreateInVaultFolder(access, folder);
      return full ? writeAll : (listing.writableFolders ?? []).some(parent => folder === parent || folder.startsWith(`${parent}/`));
    },
    edit,
    /** A path is a location. When the listing no longer has a row at the opened
     * path but identifies the same item at exactly one other path, that row
     * answers; an unknown identity stays denied. */
    editItem(itemId: string | null, path: string) {
      if (!listing || listing.items.some(entry => entry.path === path)) return edit(path);
      const located = locateVaultItem(itemId, listing);
      return edit(located ? located.path : path);
    },
  };
  function edit(path: string) {
    const item = listing?.items.find(entry => entry.path === path);
    if (typeof item?.canEditContent === 'boolean') return item.canEditContent;
    return explicit ? false : legacyLocal || Boolean(access?.fullAccess && access.canEditContent) || Boolean(item?.itemId && access?.grants.some(grant => grant.role === 'editor' && (grant.scopeType === 'item' ? grant.scopeKey === item.itemId : path.startsWith(`${grant.scopeKey}/`))));
  }
}
