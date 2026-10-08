import type { VaultItem } from "./bridge";
import { workspaceReferenceChoices } from "@/lib/presentation/workspace-reference-choices";
import { vaultRequest, type VaultFile } from "./bridge";
import { packIdentity } from "./pack";
import { readDocument } from "./model";
import type { DocumentReferenceSource } from "@/lib/presentation/workspace-reference-choices";
/** Only permission-filtered listing entries; never fetch private packs for labels. */
export function vaultReferenceChoices(items: readonly VaultItem[], currentId?: string) {
 const seen = new Set<string>();
 return workspaceReferenceChoices(items.filter(item => {
  if (!item.itemId || seen.has(item.itemId) || item.path.toLowerCase().startsWith("templates/") || !item.path.endsWith(".textpack")) return false;
  seen.add(item.itemId); return true;
 }).map(item => ({ id: item.itemId!, title: item.title?.trim() || "Untitled", type: "document" })), currentId);
}

const eligiblePath = (path: string) => path.endsWith(".textpack") && !/^(Templates|Recovered)\//i.test(path);
export const createVaultDocumentReferences = (currentId?: string, currentPath?: string): DocumentReferenceSource => ({
 async search(query, signal) {
  if (!query.trim()) return [];
  const page = await vaultRequest<{items: {path:string;title:string}[]}>("search", {query:query.trim()}, signal);
  return page.items.filter(item => eligiblePath(item.path) && item.path !== currentPath).slice(0,20)
   .map(item => ({id:`path:${item.path}`,label:item.title?.trim() || "Untitled"}));
 },
 async resolve(token, signal) {
  const path = token.startsWith("path:") ? token.slice(5)
   : (await vaultRequest<{path:string}>("resolveItemId", {itemId:token}, signal)).path;
  if (!eligiblePath(path)) throw new Error("This item is not available as a parent.");
  const file = await vaultRequest<VaultFile>("read", {path}, signal);
  const id = packIdentity(file.markdown);
  if (!id || id === currentId || file.path !== path || !token.startsWith("path:") && id !== token) throw new Error("This item changed. Search again.");
  return {id,label:readDocument(file).content.title.trim() || "Untitled"};
 },
});
