import { isUuid, resolveItemAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { getPostStoreContext } from "@/lib/store";

export const dynamic = "force-dynamic";

function notFound() {
  return Response.json({ error: "Item not found" }, { status: 404 });
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();

  const item = await getPostStoreContext(id);
  if (!item) return notFound();

  const user = await getCurrentUser();
  const access = await resolveItemAccess({
    handle: item.handle,
    postId: id,
    user,
  });
  if (!access.canView) return notFound();

  return Response.json({
    captureStatus: item.post.captureStatus ?? null,
    capture: item.post.capture ?? null,
    cover: item.post.cover ?? null,
    updatedAt: item.post.updatedAt ?? null,
    wordCount: item.post.wordCount ?? null,
  });
}
