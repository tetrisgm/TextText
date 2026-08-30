import { isUuid, resolveItemAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { getPostStoreContext } from "@/lib/store";
import { requireDocumentSnapshot } from "@/lib/documents/model";

export const dynamic = "force-dynamic";

function notFound() {
  return Response.json(
    { error: "Post not found" },
    {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
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
  if (!access.isOwner) return notFound();

  const document = requireDocumentSnapshot(
    item.post.document,
    `Post ${id}`,
  );

  return Response.json(
    {
      blogId: item.blogId,
      postId: id,
      document,
      revision: item.post.revision,
      updatedAt: item.post.updatedAt,
      fetchedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
