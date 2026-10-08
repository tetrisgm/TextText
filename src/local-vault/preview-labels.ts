import type { VaultListing } from "./bridge";
import type { FolderPreview } from "./folder-collection";

// A listing is replaced after every filesystem/server change notification.
// Never reuse labels by root/path alone: edits, moves and permission changes
// can leave those strings unchanged. Weak ownership also releases old listings.
const labels = new WeakMap<VaultListing, Map<string, FolderPreview>>();
const LIMIT = 128;

export function previewLabels(listing: VaultListing): Record<string, FolderPreview> {
  return Object.fromEntries(labels.get(listing) ?? []);
}

export function rememberPreviewLabel(listing: VaultListing, path: string, preview: FolderPreview): void {
  if (!listing.items.some(item => item.path === path)) return;
  let entries = labels.get(listing);
  if (!entries) { entries = new Map(); labels.set(listing, entries); }
  entries.delete(path);
  // Keep only bounded display text, never images, documents or object URLs.
  entries.set(path, { title: preview.title.slice(0, 240), excerpt: preview.excerpt.slice(0, 300) });
  while (entries.size > LIMIT) entries.delete(entries.keys().next().value!);
}
