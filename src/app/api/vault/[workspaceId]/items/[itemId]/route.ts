import { authorizeVault } from "@/app/api/vault/auth";
import { readVaultTextpack, readVaultTemplate, readVaultPreview, writeVaultTextpack, moveVaultTextpack, deleteVaultTextpack, VaultBusyError } from "@/lib/store";
import { readBoundedJson } from "@/lib/http/bounded-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspaceId: string; itemId: string }> };
const MAX_BYTES = 64 * 1024 * 1024;
const noCache = { "Cache-Control": "no-store" };

async function authorize(request: Request, context: Context) {
  const params = await context.params;
  const identity = await authorizeVault(request, params.workspaceId);
  if (identity instanceof Response) return identity;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(params.itemId)) return Response.json({ error: "Invalid item identifier" }, { status: 400, headers: noCache });
  return { ...identity, itemId: params.itemId };
}

function failure(error: unknown): Response {
  if (error instanceof VaultBusyError) return Response.json({ error: "Vault is busy. Retry this operation." }, {
    status: 503, headers: { ...noCache, "Retry-After": "1" },
  });
  if (error instanceof Error && /reused|another item|move operation/.test(error.message)) {
    return Response.json({ error: error.message }, { status: 409, headers: noCache });
  }
  if (error instanceof Error && /Invalid |TextPack|text.md|document.json|identifier/.test(error.message)) {
    return Response.json({ error: "Invalid TextPack or file metadata" }, { status: 422, headers: noCache });
  }
  return Response.json({ error: "Vault operation could not complete. Retry with the same operation identifier." }, { status: 503, headers: noCache });
}

export async function GET(request: Request, context: Context) {
  const authorized = await authorize(request, context);
  if (authorized instanceof Response) return authorized;
  try {
    if (new URL(request.url).searchParams.get("metadata") === "preview") {
      const preview = await readVaultPreview({ ...authorized, metadataOnly: new URL(request.url).searchParams.get("metadataOnly") === "1" });
      return preview ? Response.json(preview, { headers: noCache })
        : Response.json({ error: "Item not found" }, { status: 404, headers: noCache });
    }
    if (new URL(request.url).searchParams.get("metadata") === "template") {
      const template = await readVaultTemplate(authorized);
      return template ? Response.json(template, { headers: noCache })
        : Response.json({ error: "Item not found" }, { status: 404, headers: noCache });
    }
    const item = await readVaultTextpack(authorized);
    if (!item) return Response.json({ error: "Item not found" }, { status: 404, headers: noCache });
    return new Response(new Uint8Array(item.bytes), { headers: {
      ...noCache,
      "Content-Type": "application/zip",
      ETag: `"${item.revision}"`,
      "X-TextText-Path": encodeURIComponent(item.relativePath),
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request, context: Context) {
  const authorized = await authorize(request, context);
  if (authorized instanceof Response) return authorized;
  const operationId = request.headers.get("X-TextText-Operation-Id");
  const encodedPath = request.headers.get("X-TextText-Path");
  const match = request.headers.get("If-Match");
  const create = request.headers.get("If-None-Match");
  if (!operationId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(operationId) || !encodedPath) {
    return Response.json({ error: "Operation identifier and encoded TextPack path are required" }, { status: 400, headers: noCache });
  }
  if (!((create === "*" && !match) || (!create && match && /^"[a-f0-9]{64}"$/.test(match)))) {
    return Response.json({ error: "Use If-None-Match: * to create or If-Match with the last ETag to update" }, { status: 428, headers: noCache });
  }
  let relativePath: string;
  try { relativePath = decodeURIComponent(encodedPath); }
  catch { return Response.json({ error: "Invalid encoded path" }, { status: 400, headers: noCache }); }
  const contentLength = Number(request.headers.get("Content-Length"));
  if (contentLength > MAX_BYTES) return Response.json({ error: "TextPack exceeds 64 MiB" }, { status: 413, headers: noCache });
  if (!request.body) return Response.json({ error: "TextPack body is required" }, { status: 400, headers: noCache });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return Response.json({ error: "TextPack exceeds 64 MiB" }, { status: 413, headers: noCache });
      }
      chunks.push(chunk.value);
    }
    const result = await writeVaultTextpack({ ...authorized, operationId, relativePath,
      baseRevision: match ? match.slice(1, -1) : null,
      bytes: Buffer.concat(chunks, size),
    });
    return Response.json(result, { status: result.status === "conflict" ? 409 : 200, headers: noCache });
  } catch (error) { return failure(error); }
  finally { reader.releaseLock(); }
}

async function mutateEntry(request: Request, context: Context, kind: "move" | "delete") {
  const authorized = await authorize(request, context);
  if (authorized instanceof Response) return authorized;
  const operationId = request.headers.get("X-TextText-Operation-Id");
  const encodedBase = request.headers.get("X-TextText-Base-Path");
  const match = request.headers.get("If-Match");
  if (!operationId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(operationId) || !encodedBase || !match || !/^"[a-f0-9]{64}"$/.test(match)) {
    return Response.json({ error: "Operation identifier, encoded base path, and If-Match ETag are required" }, { status: 428, headers: noCache });
  }
  let basePath: string;
  try { basePath = decodeURIComponent(encodedBase); }
  catch { return Response.json({ error: "Invalid encoded base path" }, { status: 400, headers: noCache }); }
  try {
    const input = { ...authorized, operationId, basePath, baseRevision: match.slice(1, -1) };
    let result;
    if (kind === "move") {
      const parsed = await readBoundedJson<{ relativePath?: unknown }>(request, 4096);
      if ("error" in parsed || typeof parsed.value.relativePath !== "string") {
        return Response.json({ error: "Send a relativePath for the move" }, { status: 400, headers: noCache });
      }
      result = await moveVaultTextpack({ ...input, relativePath: parsed.value.relativePath });
    } else result = await deleteVaultTextpack(input);
    return Response.json(result, { status: result.status === "conflict" ? 409 : 200, headers: noCache });
  } catch (error) { return failure(error); }
}

export const PATCH = (request: Request, context: Context) => mutateEntry(request, context, "move");
export const DELETE = (request: Request, context: Context) => mutateEntry(request, context, "delete");
