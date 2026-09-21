import type { AssistantWorkspaceContextItem } from "./AssistantSidebar";
import { normalizeStoredPostDocument } from "@/lib/pool/storage";
import type { WorkspaceItemTextSnapshot } from "@/lib/ai/workspace-item-draft";

/** Native agents also need sources absent from the navigation pool, freshly authorized. */
export async function fetchContextSourceText(blogId: string, postId: string): Promise<WorkspaceItemTextSnapshot> {
  const response = await fetch(`/api/post/${encodeURIComponent(postId)}/body`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("This source is no longer available.");
  const payload = normalizeStoredPostDocument(await response.json(), { blogId, postId });
  if (!payload) throw new Error("Source response mismatch");
  return { title: payload.document.content.title, body: payload.document.content.body, excerpt: payload.document.content.subtitle || "", revision: payload.revision };
}

export async function fetchContextSources(handle: string, lookup: { query: string } | { ids: string[] }, signal: AbortSignal): Promise<AssistantWorkspaceContextItem[]> {
  const params = new URLSearchParams({ handle });
  if ("query" in lookup) params.set("q", lookup.query);
  else params.set("ids", lookup.ids.join(","));
  const response = await fetch(`/api/workspace/reading/context?${params}`, { signal, credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Could not search sources");
  return (await response.json()).items;
}
