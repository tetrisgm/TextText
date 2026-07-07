// Capture result upload (multipart/form-data):
//
//   PUT /api/sync/v1/captures/{postId}
//     meta       JSON string: {url, title?, siteName?, description?,
//                capturedBy?, error?} (error marks the capture failed)
//     readable   optional text field: readable extraction as markdown; lands
//                in the post body only when the body is empty
//     screenshot optional PNG file -> Blob
//     html       optional original page HTML file -> Blob
//
// -> {item: {id, slug, captureStatus}}. Artifacts go to Blob storage under
// captures/{handle}/{postId}/; their URLs land in posts.capture.

import type { BookmarkCapture } from "@/lib/content";
import { recordAction } from "@/lib/audit";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { saveBookmarkCapture } from "@/lib/store";
import { resolveSyncWorkspace } from "../../auth";
import { syncError } from "../../sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

function formFile(form: FormData, name: string): File | null {
  const value = form.get(name);
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).arrayBuffer === "function" &&
    (value as File).size > 0
  ) {
    return value as File;
  }
  return null;
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog, userId } = workspace;
  const { postId } = await ctx.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return syncError(400, "Send multipart/form-data");
  }

  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(String(form.get("meta") ?? "{}"));
  } catch {
    return syncError(400, "meta must be JSON");
  }
  const url = typeof meta.url === "string" ? meta.url : "";
  if (!url) return syncError(400, "meta.url is required");
  const error = typeof meta.error === "string" && meta.error ? meta.error : null;

  const capture: BookmarkCapture = {
    url,
    title: typeof meta.title === "string" ? meta.title : undefined,
    siteName: typeof meta.siteName === "string" ? meta.siteName : undefined,
    description:
      typeof meta.description === "string" ? meta.description : undefined,
    capturedAt: new Date().toISOString(),
    capturedBy: typeof meta.capturedBy === "string" ? meta.capturedBy : "agent",
    error: error ?? undefined,
  };

  // Artifacts only for successful captures; a failure report is metadata-only.
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!error && blobToken) {
    const screenshot = formFile(form, "screenshot");
    const html = formFile(form, "html");
    if (
      (screenshot && screenshot.size > MAX_ARTIFACT_BYTES) ||
      (html && html.size > MAX_ARTIFACT_BYTES)
    ) {
      return syncError(413, "Capture artifacts must be 25 MB or smaller");
    }
    if (screenshot || html) {
      const { put } = await import("@vercel/blob");
      if (screenshot) {
        const blob = await put(
          `captures/${blog.handle}/${postId}/screenshot.png`,
          screenshot,
          {
            access: "public",
            addRandomSuffix: true,
            contentType: "image/png",
            token: blobToken,
          },
        );
        capture.screenshotUrl = blob.url;
      }
      if (html) {
        const blob = await put(
          `captures/${blog.handle}/${postId}/page.html`,
          html,
          {
            access: "public",
            addRandomSuffix: true,
            contentType: "text/html; charset=utf-8",
            token: blobToken,
          },
        );
        capture.htmlUrl = blob.url;
      }
    }
  }

  const readableValue = form.get("readable");
  const readableMarkdown =
    typeof readableValue === "string" ? readableValue : undefined;

  const saved = await saveBookmarkCapture(blog.handle, postId, capture, {
    readableMarkdown,
    failed: Boolean(error),
  });
  if (!saved) return syncError(404, "No such bookmark");

  await recordAction({
    actorUserId: userId,
    actorType: "external_agent",
    actionName: "sync.capture_bookmark",
    targetType: "item",
    targetId: saved.id,
    inputSummary: url,
    outputSummary: error ? `failed: ${error}` : "captured",
  });
  revalidateBlogPaths(blog, [saved.slug]);
  return Response.json({
    item: { id: saved.id, slug: saved.slug, captureStatus: saved.captureStatus },
  });
}
