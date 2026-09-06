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
  const canReadByLink = item.post.status === "published" &&
    (item.post.visibility === "public" || item.post.visibility === "link");
  if (!access.canView && capability?.itemId !== id && !canReadByLink) return missing();
  return Response.json({ revision: readerRevision(item.post) }, { headers });
}
