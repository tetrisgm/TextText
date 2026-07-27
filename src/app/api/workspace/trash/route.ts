import { recordAction } from "@/lib/audit";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import type { Post } from "@/lib/content";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import {
  deletePost,
  emptyTrash,
  getBlog,
  getPostById,
  permanentlyDeleteFolder,
  permanentlyDeletePost,
  restoreFolder,
  restorePost,
} from "@/lib/store";

export const dynamic = "force-dynamic";

type TrashOperation =
  | { operation: "empty"; handle: string }
  | { operation: "trash-posts"; handle: string; targetIds: string[] }
  | { operation: "restore-post"; handle: string; targetId: string }
  | { operation: "restore-folder"; handle: string; targetId: string }
  | { operation: "delete-post"; handle: string; targetId: string }
  | { operation: "delete-folder"; handle: string; targetId: string };

function cleanText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${label}`);
  }
  return value.trim();
}

function parseOperation(value: unknown): TrashOperation {
  if (!value || typeof value !== "object") throw new Error("Invalid request");
  const input = value as Record<string, unknown>;
  const operation = cleanText(input.operation, "operation");
  const handle = cleanText(input.handle, "workspace handle");
  if (operation === "empty") return { operation, handle };
  if (operation === "trash-posts") {
    if (!Array.isArray(input.targetIds)) throw new Error("Missing targets");
    const targetIds = Array.from(
      new Set(input.targetIds.map((targetId) => cleanText(targetId, "target"))),
    ).slice(0, 100);
    if (targetIds.length === 0) throw new Error("Missing targets");
    return { operation, handle, targetIds };
  }
  const targetId = cleanText(input.targetId, "target");
  if (
    operation === "restore-post" ||
    operation === "restore-folder" ||
    operation === "delete-post" ||
    operation === "delete-folder"
  ) {
    return { operation, handle, targetId };
  }
  throw new Error("Unsupported Trash operation");
}

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  let input: TrashOperation;
  try {
    input = parseOperation(await request.json());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid request", 400);
  }

  const access = await getBlogEditAccess(input.handle);
  if (!access.canEdit) return jsonError("Workspace not found", 404);

  let removed = 0;
  let title: string | undefined;
  switch (input.operation) {
    case "empty":
      removed = await emptyTrash(input.handle);
      break;
    case "trash-posts": {
      const posts = (
        await Promise.all(
          input.targetIds.map((targetId) =>
            getPostById(input.handle, targetId),
          ),
        )
      ).filter((post): post is Post & { id: string } => Boolean(post?.id));
      for (const post of posts) {
        await deletePost(input.handle, post.id);
        await recordAction({
          actorUserId: access.isOwner ? access.ownerId : null,
          actorType: "human",
          actionName: "delete_post",
          targetType: "item",
          targetId: post.id,
          inputSummary: post.title,
        });
      }
      removed = posts.length;
      break;
    }
    case "restore-post":
      title = (await restorePost(input.handle, input.targetId)).title;
      break;
    case "restore-folder":
      await restoreFolder(input.handle, input.targetId);
      break;
    case "delete-post":
      await permanentlyDeletePost(input.handle, input.targetId);
      break;
    case "delete-folder":
      await permanentlyDeleteFolder(input.handle, input.targetId);
      break;
  }

  const auditNames: Record<TrashOperation["operation"], string> = {
    empty: "empty_trash",
    "trash-posts": "delete_post",
    "restore-post": "restore_post",
    "restore-folder": "restore_folder",
    "delete-post": "permanently_delete_post",
    "delete-folder": "permanently_delete_folder",
  };
  if (input.operation !== "trash-posts") {
    await recordAction({
      actorUserId: access.isOwner ? access.ownerId : null,
      actorType: "human",
      actionName: auditNames[input.operation],
      targetType: input.operation === "empty" ? "workspace" : "item",
      targetId: input.operation === "empty" ? input.handle : input.targetId,
      inputSummary:
        input.operation === "empty" ? `${removed} items` : title,
    });
  }

  const blog = await getBlog(input.handle);
  revalidateBlogPaths(blog ?? { handle: input.handle });
  return Response.json(
    { ok: true, removed },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
