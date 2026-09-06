import { cookies } from "next/headers";
import { documentCapabilityCookieName } from "@/lib/document-capability";
import { isUuid, resolveItemAccess } from "@/lib/permissions";
import { readerRevision } from "@/lib/reader-revision";
import { getCurrentUser } from "@/lib/session";
import { getPostStoreContext, resolveDocumentCapability } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const missing = () => Response.json({ error: "Item not found" }, { status: 404, headers });
  const { id } = await ctx.params;
  if (!isUuid(id)) return missing();
  const item = await getPostStoreContext(id);
  if (!item) return missing();
  const user = await getCurrentUser();
  const access = await resolveItemAccess({ handle: item.handle, postId: id, user });
  const token = (await cookies()).get(documentCapabilityCookieName(id))?.value;
  const capability = token ? await resolveDocumentCapability(token) : null;
  // Read live eligibility and its revision together after asynchronous access
  // resolution. The first lookup supplies only the workspace for that decision.
  const current = await getPostStoreContext(id);
  if (!current || current.handle !== item.handle) return missing();
  const canReadByLink = current.post.status === "published" &&
    (current.post.visibility === "public" || current.post.visibility === "link");
  if (!access.canView && capability?.itemId !== id && !canReadByLink) return missing();
  return Response.json({ revision: readerRevision(current.post) }, { headers });
}
