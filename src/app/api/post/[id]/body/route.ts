import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { blogs, posts } from "@/lib/db/schema";
import { isUuid, resolveItemAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

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
  if (!db || !isUuid(id)) return notFound();

  const rows = await db
    .select({
      blogId: blogs.id,
      handle: blogs.handle,
      body: posts.body,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(posts.id, id),
        isNull(posts.deletedAt),
        isNull(blogs.deletedAt),
      ),
    )
    .limit(1);
  const item = rows[0];
  if (!item) return notFound();

  const user = await getCurrentUser();
  const access = await resolveItemAccess({
    handle: item.handle,
    postId: id,
    user,
  });
  if (!access.isOwner) return notFound();

  return Response.json(
    {
      blogId: item.blogId,
      postId: id,
      body: item.body,
      updatedAt: item.updatedAt.toISOString(),
      fetchedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
