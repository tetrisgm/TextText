import { runWorkspaceToolForSession } from "@/lib/mcp/tools";
import { documentSnapshotSchema } from "@/lib/documents/model";

type Actor = Parameters<typeof runWorkspaceToolForSession>[2];
export async function canonicalContextItem(actor: Actor, id: string) {
  const result = await runWorkspaceToolForSession("read_item", { id }, actor);
  if (result.isError) return null;
  const item = result.structuredContent?.item as Record<string, unknown> | undefined;
  const document = documentSnapshotSchema.safeParse(item?.document);
  if (!item || item.id !== id || typeof item.hash !== "string" || !/^[a-f0-9]{64}$/.test(item.hash) || !document.success) return null;
  return { id, revision: item.hash, title: document.data.content.title, body: document.data.content.body,
    excerpt: document.data.content.subtitle ?? "", slug: id,
    folderPath: typeof item.folder_path === "string" ? item.folder_path : "" };
}

export async function canonicalContextIndex(actor: Actor, folderPath?: string) {
  const result = await runWorkspaceToolForSession("list_items", { limit: 12, ...(folderPath ? { folder_path: folderPath } : {}) }, actor);
  if (result.isError) throw new Error("Workspace context unavailable.");
  const items = result.structuredContent?.items;
  if (!Array.isArray(items)) return [];
  return items.slice(0, 12).flatMap(item => {
    if (!item || typeof item.id !== "string" || typeof item.path !== "string" || typeof item.title !== "string") return [];
    const slash = item.path.lastIndexOf("/");
    return [{ folderPath: slash < 0 ? "" : item.path.slice(0, slash), post: { id: item.id, title: item.title, slug: item.id,
      excerpt: typeof item.excerpt === "string" ? item.excerpt : "" } }];
  });
}
