import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_SIZE_BYTES = MAX_FILE_SIZE_BYTES + 1024 * 1024;
const UPLOAD_FIELD_NAME = "file";
const UPLOAD_PREFIX = "editor/media";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isImageContentType(contentType: string) {
  return contentType.toLowerCase().startsWith("image/");
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

function uploadPathname(file: File) {
  const date = new Date().toISOString().slice(0, 10);
  return `${UPLOAD_PREFIX}/${date}/${safePathSegment(file.name)}`;
}

export async function POST(request: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (!token) {
    return jsonError("Media upload is not configured.", 503);
  }

  // When auth is configured, uploads are for signed-in users only (the endpoint
  // writes to the owner's Blob store, so it must not be open to the public).
  if (isAuthConfigured && !(await getCurrentUser())) {
    return jsonError("Sign in to upload media.", 401);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return jsonError("Expected multipart/form-data with a single file field.", 415);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE_BYTES) {
    return jsonError("Image file must be 8 MB or smaller.", 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("Invalid multipart form data.", 400);
  }

  const files = formData.getAll(UPLOAD_FIELD_NAME).filter(isUploadFile);
  if (files.length !== 1) {
    return jsonError("Upload exactly one image file in the file field.", 400);
  }

  const file = files[0];
  if (file.size === 0) {
    return jsonError("Image file must not be empty.", 400);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return jsonError("Image file must be 8 MB or smaller.", 413);
  }

  if (!isImageContentType(file.type)) {
    return jsonError("Only image uploads are supported.", 415);
  }

  try {
    const { put } = await import("@vercel/blob");
    const blob = await put(uploadPathname(file), file, {
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
