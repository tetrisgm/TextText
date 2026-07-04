import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import { ensureOwnerBlog } from "@/lib/store";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_REQUEST_SIZE_BYTES = MAX_FILE_SIZE_BYTES + 1024 * 1024;
const UPLOAD_FIELD_NAME = "file";
const UPLOAD_PREFIX = "editor/media";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isMediaContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  return normalized.startsWith("image/") || normalized.startsWith("video/");
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).name === "string" &&
    typeof (value as File).size === "number" &&
    typeof (value as File).type === "string"
  );
}

function safePathSegment(name: string) {
  const trimmed = name.trim().toLowerCase();
  const safe = trimmed
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return safe || "upload";
}

function uploadPathname(handle: string, file: File) {
  const date = new Date().toISOString().slice(0, 10);
  return `${UPLOAD_PREFIX}/${safePathSegment(handle)}/${date}/${safePathSegment(file.name)}`;
}

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (!token) {
    return jsonError("Media upload is not configured.", 503);
  }

  // Uploads always require a signed-in user; this is never an open public
  // endpoint. Demo mode (auth off) has no owner to attribute media to.
  if (!isAuthConfigured) {
    return jsonError("Media upload requires authentication.", 503);
  }
  const user = await getCurrentUser();
  if (!user) {
    return jsonError("Sign in to upload media.", 401);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return jsonError("Expected multipart/form-data with a single file field.", 415);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE_BYTES) {
    return jsonError("Media must be 50 MB or smaller.", 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("Invalid multipart form data.", 400);
  }

  const files = formData.getAll(UPLOAD_FIELD_NAME).filter(isUploadFile);
  if (files.length !== 1) {
    return jsonError("Upload exactly one media file in the file field.", 400);
  }

  const file = files[0];
  if (file.size === 0) {
    return jsonError("Media file must not be empty.", 400);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return jsonError("Media must be 50 MB or smaller.", 413);
  }

  if (!isMediaContentType(file.type)) {
    return jsonError("Only photos and videos can be uploaded.", 415);
  }

  try {
    const { handle } = await ensureOwnerBlog(user);
    const { put } = await import("@vercel/blob");
    const blob = await put(uploadPathname(handle, file), file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
      token,
    });

    return Response.json({ url: blob.url });
  } catch (error) {
    console.error("Media upload failed", error);
    return jsonError("Media upload failed.", 502);
  }
}
