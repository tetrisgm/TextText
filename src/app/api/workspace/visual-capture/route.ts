import { getCurrentUser } from "@/lib/session";
import { resolveFolderAccess, isUuid } from "@/lib/permissions";
import { TENANT_HANDLE_RE } from "@/lib/tenants";
import {
  claimIdempotencyKey,
  countPersonalPosts,
  createDraftInFolder,
  getBlog,
  getFolderByPath,
  getOwnerPlan,
  getPostById,
  releaseIdempotencyKey,
} from "@/lib/store";
import { cleanPlanTier, planLimits } from "@/lib/product-limits";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function error(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function uploadFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value === "object" && "arrayBuffer" in value && "size" in value && "name" in value);
}

/** Signed-in folder capture. One file becomes one private visual TextPack item. */
export async function POST(request: Request) {
  // A cross-site HTML form cannot set this header. Session cookies alone are
  // insufficient for a new multipart mutation endpoint.
  if (request.headers.get("x-texttext-visual-capture") !== "1") return error(403, "Upload was not authorized.");
  if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    return error(415, "Choose an image to upload.");
  }
  const user = await getCurrentUser();
  if (!user) return error(401, "Sign in to add images.");

  const { MAX_VISUAL_ASSET_BYTES, prepareVisualAsset, visualAssetFilename } = await import("@/lib/visual-assets");
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_VISUAL_ASSET_BYTES + 1024 * 1024) {
    return error(413, "Images must be 50 MB or smaller.");
  }
  let form: FormData;
  try { form = await request.formData(); }
  catch { return error(400, "The image could not be read."); }
  const handle = form.get("handle");
  const folderPath = form.get("folderPath");
  const uploadKey = form.get("uploadKey");
  const files = form.getAll("file");
  if (typeof handle !== "string" || !TENANT_HANDLE_RE.test(handle) ||
      typeof folderPath !== "string" || !folderPath || folderPath.length > 500 ||
      typeof uploadKey !== "string" || !isUuid(uploadKey) ||
      files.length !== 1 || !uploadFile(files[0])) {
    return error(400, "Invalid image upload.");
  }
  const file = files[0];
  const [blog, folder] = await Promise.all([getBlog(handle), getFolderByPath(handle, folderPath)]);
  if (!blog || !folder) return error(404, "Folder not found.");
  const access = await resolveFolderAccess({ handle, folderId: folder.id, user });
  if (!access.canEditContent) return error(403, "You cannot add items to this folder.");
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return error(503, "Image storage is unavailable. Try again later.");

  const key = `visual:${uploadKey}`;
  const claim = await claimIdempotencyKey(handle, key, { staleAfterMs: 120_000 });
  if (claim.status === "done") {
    const existing = claim.kind === "post" ? await getPostById(handle, claim.id) : null;
    if (!existing || existing.folderId !== folder.id) return error(409, "This upload belongs to another item.");
    return Response.json({ id: existing.id, slug: existing.slug, title: existing.title, replayed: true }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (claim.status === "inflight") return error(409, "Image is still saving. Retry shortly.");

  try {
    const tier = cleanPlanTier(await getOwnerPlan(handle));
    if ((await countPersonalPosts(handle)) >= planLimits(tier).maxPosts) {
      await releaseIdempotencyKey(handle, key);
      return error(403, "This workspace reached its item limit.");
    }
    const prepared = await prepareVisualAsset(file);
    const filename = visualAssetFilename(file.name, prepared.originalContentType);
    const title = file.name.replace(/\.[^.]+$/, "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160) || "Image";
    const pathname = `documents/${handle}/visual/${uploadKey}`;
    const { put } = await import("@vercel/blob");
    const original = await put(`${pathname}/${filename}`, prepared.original, {
      access: "public", addRandomSuffix: true, allowOverwrite: false,
      contentType: prepared.originalContentType, token,
    });
    const still = await put(`${pathname}/preview.webp`, prepared.preview, {
      access: "public", addRandomSuffix: true, allowOverwrite: false,
      contentType: "image/webp", token,
    });
    const document = validateDocumentSnapshot({
      schemaVersion: 1,
      content: {
        title, body: "", fields: { cover: still.url }, tags: [],
        assets: [{
          id: uploadKey, kind: "image", src: original.url, poster: still.url,
          alt: title, contentType: prepared.originalContentType,
          width: prepared.width, height: prepared.height,
        }],
      },
      presentation: { template: { id: "texttext.gallery", version: 1 }, theme: {} },
    });
    const created = await createDraftInFolder(handle, folder.id, {
      document,
      template: { id: "texttext.gallery", version: 1 },
      initial: { type: "media_post", title, slug: title },
      idempotencyKey: key,
      audit: {
        actorUserId: access.userId,
        actorType: "human",
        actionName: "create_visual_item",
        targetType: "item",
        inputSummary: `${filename} (${prepared.original.byteLength} bytes)`,
      },
    });
    revalidateBlogPaths(blog, [created.slug]);
    return Response.json({ id: created.id, slug: created.slug, title: created.title, replayed: false }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    await releaseIdempotencyKey(handle, key).catch(() => {});
    if (cause instanceof Error && /^(Choose|Images must|This image|Use a JPEG|Image size)/.test(cause.message)) {
      return error(415, cause.message);
    }
    console.error("Visual capture failed", cause instanceof Error ? cause.name : "unknown error");
    return error(502, "Could not save this image. Retry to keep your copy.");
  }
}
