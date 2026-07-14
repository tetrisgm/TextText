import { recordAction } from "@/lib/audit";
import { resolveItemAccess } from "@/lib/permissions";
import { getPostById } from "@/lib/store";
import { resolveSyncWorkspace } from "../../../auth";
import { isUuid, syncError } from "../../../sync";

interface Props {
  params: Promise<{ postId: string }>;
}

const MAX_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_ASSET_BYTES + 1024 * 1024;
const MAX_FILENAME_LENGTH = 240;
const UPLOAD_FIELD = "file";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: Props) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;

  const { postId } = await params;
  if (!isUuid(postId)) return syncError(404, "Post not found");
  const post = await getPostById(workspace.blog.handle, postId);
  if (!post) return syncError(404, "Post not found");
  const access = await resolveItemAccess({
    handle: workspace.blog.handle,
    postId,
    user: workspace,
  });
  if (!access.canView) return syncError(404, "Post not found");
  if (!access.canEditContent) {
    return syncError(403, "You cannot upload assets to this file");
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return syncError(503, "Document asset storage is not configured");

  const requestContentType = request.headers.get("content-type") ?? "";
  if (!requestContentType.toLowerCase().includes("multipart/form-data")) {
    return syncError(415, "Send multipart/form-data with one file field");
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return syncError(413, "Asset must be 50 MB or smaller");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return syncError(400, "Invalid multipart form data");
  }

  const fileEntries = [...form.entries()].filter(
    (entry): entry is [string, File] => isUploadFile(entry[1]),
  );
  if (fileEntries.length !== 1 || fileEntries[0]?.[0] !== UPLOAD_FIELD) {
    return syncError(400, "Upload exactly one asset in the file field");
  }
  const file = fileEntries[0][1];
  if (file.size === 0) return syncError(400, "Asset must not be empty");
  if (file.size > MAX_ASSET_BYTES) {
    return syncError(413, "Asset must be 50 MB or smaller");
  }
  const contentType = normalizedMediaContentType(file.type);
  if (!contentType) {
    return syncError(415, "Only images and videos can be uploaded");
  }

  const uploadFilename = safeUploadFilename(file.name, contentType);
  const pathname =
    `documents/${workspace.blog.handle}/${postId}/assets/${uploadFilename}`;

  let blob: Awaited<ReturnType<typeof import("@vercel/blob")["put"]>>;
  try {
    const { put } = await import("@vercel/blob");
    blob = await put(pathname, file, {
      access: "public",
      addRandomSuffix: true,
      allowOverwrite: false,
      contentType,
      token,
    });
  } catch (error) {
    console.error("Document asset upload failed", error);
    return syncError(502, "Document asset upload failed");
  }

  const storedContentType = normalizedMediaContentType(blob.contentType) ?? contentType;
  const artifact = {
    filename: safeUploadFilename(filenameFromPath(blob.pathname), storedContentType),
    role: "asset" as const,
    url: blob.url,
    contentType: storedContentType,
  };
  await recordAction({
    actorUserId: workspace.userId,
    actorType: "external_agent",
    actionName: "sync.upload_asset",
    targetType: "item",
    targetId: postId,
    inputSummary: `${uploadFilename} (${contentType}, ${file.size} bytes)`,
    outputSummary: blob.url,
  });

  return Response.json(
    { artifact },
    {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

function isUploadFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).name === "string" &&
    typeof (value as File).size === "number" &&
    typeof (value as File).type === "string"
  );
}

function normalizedMediaContentType(contentType: string): string | null {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return /^(?:image|video)\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)
    ? normalized
    : null;
}

function safeUploadFilename(value: string, contentType: string): string {
  const source = filenameFromPath(value);
  const sourceExtension = fileExtension(source);
  const extension = extensionForContentType(contentType) ?? sourceExtension ?? "bin";
  const withoutExtension = sourceExtension
    ? source.slice(0, -(sourceExtension.length + 1))
    : source;
  let stem = withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!stem) stem = "asset";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
    stem = `asset-${stem}`;
  }
  stem = stem.slice(0, Math.max(1, MAX_FILENAME_LENGTH - extension.length - 1));
  return `${stem}.${extension}`;
}

function filenameFromPath(value: string): string {
  const encoded = value.split(/[\\/]/).filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function fileExtension(filename: string): string | undefined {
  return filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1];
}

function extensionForContentType(contentType: string): string | undefined {
  switch (contentType) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "image/avif": return "avif";
    case "image/svg+xml": return "svg";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    case "image/tiff": return "tiff";
    case "video/mp4": return "mp4";
    case "video/quicktime": return "mov";
    case "video/webm": return "webm";
    case "video/mpeg": return "mpg";
    case "video/x-m4v": return "m4v";
    case "video/ogg": return "ogv";
    default: return undefined;
  }
}
