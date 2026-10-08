import type { VaultItem } from "./bridge";
import { workspaceReferenceChoices } from "@/lib/presentation/workspace-reference-choices";
/** Only permission-filtered listing entries; never fetch private packs for labels. */
export function vaultReferenceChoices(items: readonly VaultItem[], currentId?: string) {
 const seen = new Set<string>();
 return workspaceReferenceChoices(items.filter(item => {
  if (!item.itemId || seen.has(item.itemId) || item.path.toLowerCase().startsWith("templates/") || !item.path.endsWith(".textpack")) return false;
  seen.add(item.itemId); return true;
 }).map(item => ({ id: item.itemId!, title: item.title?.trim() || "Untitled", type: "document" })), currentId);
}
