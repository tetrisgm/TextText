import { and, eq, isNull } from "drizzle-orm";
import type { BookmarkCapture, CaptureStatus } from "@/lib/content";
import { db } from "@/lib/db/client";
import { blogs, posts } from "@/lib/db/schema";
import { isUuid, resolveItemAccess } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function cleanCaptureStatus(value: string | null): CaptureStatus | null {
  if (value === "pending" || value === "captured" || value === "failed") {
    return value;
  }
  return null;
}

function notFound() {
  return Response.json({ error: "Item not found" }, { status: 404 });
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!db || !isUuid(id)) return notFound();

  const rows = await db
    .select({
      handle: blogs.handle,
      captureStatus: posts.captureStatus,
      capture: posts.capture,
      cover: posts.cover,
      updatedAt: posts.updatedAt,
      wordCount: posts.wordCount,
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
  if (!access.canView) return notFound();

  return Response.json({
    captureStatus: cleanCaptureStatus(item.captureStatus),
    capture: item.capture as BookmarkCapture | null,
    cover: item.cover,
    updatedAt: item.updatedAt.toISOString(),
    wordCount: item.wordCount,
  });
}
