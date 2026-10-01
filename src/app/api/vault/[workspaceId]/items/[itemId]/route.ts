import { authorizeVaultItem, authorizeVaultItemAtPath } from "@/app/api/vault/scoped-auth";
import { readVaultTextpack, readVaultTemplate, readVaultPreview, writeVaultTextpack, moveVaultTextpack, deleteVaultTextpack, VaultBusyError } from "@/lib/store";
import { readBoundedJson } from "@/lib/http/bounded-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspaceId: string; itemId: string }> };
const MAX_BYTES = 64 * 1024 * 1024;
const noCache = { "Cache-Control": "no-store" };

async function authorize(request: Request, context: Context, capability: "read" | "edit") {
  const params = await context.params;
  const identity = await authorizeVaultItem(request, params.workspaceId, params.itemId, capability);
  if (identity instanceof Response) return identity;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(params.itemId)) return Response.json({ error: "Invalid item identifier" }, { status: 400, headers: noCache });
  return { ...identity, itemId: params.itemId };
}

function commitGuard(request: Request, context: Context, actorUserId: string,
  requireWorkspaceEdit = false, requireNativeEditor = false) {
  return { signal: request.signal, beforeCommit: async (relativePath: string) => {
    const { workspaceId, itemId } = await context.params;
    const latest = await authorizeVaultItemAtPath(request, workspaceId, itemId, relativePath, "edit");
    if (latest instanceof Response) throw latest;
    if (latest.actorUserId !== actorUserId) throw Response.json({ error: "Session changed" }, { status: 403, headers: noCache });
    if (requireWorkspaceEdit && !latest.fullAccess) throw Response.json({ error: "Workspace editing permission is required" }, { status: 403, headers: noCache });
    if (requireNativeEditor && !latest.canAttributeNativeEditor) throw Response.json({ error: "An app token is required for native editor attribution" }, { status: 403, headers: noCache });
  } };
}

function failure(error: unknown): Response {
  if (error instanceof Response) return error;
  if (error instanceof Error && error.name === "AbortError") return new Response(null, { status: 204, headers: noCache });
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
  const authorized = await authorize(request, context, "read");
  if (authorized instanceof Response) return authorized;
  try {
    if (new URL(request.url).searchParams.get("metadata") === "preview") {
      const preview = await readVaultPreview({ ...authorized, metadataOnly: new URL(request.url).searchParams.get("metadataOnly") === "1" });
      const current = await authorize(request, context, "read");
      if (current instanceof Response) return current;
      if (current.relativePath !== authorized.relativePath) return Response.json({ error: "Item moved. Retry reading it." }, { status: 409, headers: noCache });
      return preview ? Response.json(preview, { headers: noCache })
        : Response.json({ error: "Item not found" }, { status: 404, headers: noCache });
    }
    if (new URL(request.url).searchParams.get("metadata") === "template") {
      const template = await readVaultTemplate(authorized);
      const current = await authorize(request, context, "read");
      if (current instanceof Response) return current;
      if (current.relativePath !== authorized.relativePath) return Response.json({ error: "Item moved. Retry reading it." }, { status: 409, headers: noCache });
      return template ? Response.json(template, { headers: noCache })
        : Response.json({ error: "Item not found" }, { status: 404, headers: noCache });
    }
    const item = await readVaultTextpack(authorized);
    const current = await authorize(request, context, "read");
    if (current instanceof Response) return current;
    if (current.relativePath !== item?.relativePath) return Response.json({ error: "Item moved. Retry reading it." }, { status: 409, headers: noCache });
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
  const { workspaceId, itemId } = await context.params;
  const authorized = await authorizeVaultItemAtPath(request, workspaceId, itemId, relativePath, "edit");
  if (authorized instanceof Response) return authorized;
  const editOrigin = request.headers.get("X-TextText-Edit-Origin");
  if (editOrigin !== null && editOrigin !== "native-editor") {
    return Response.json({ error: "Invalid edit origin" }, { status: 400, headers: noCache });
  }
  if (editOrigin && !authorized.canAttributeNativeEditor) {
    return Response.json({ error: "An app token is required for native editor attribution" }, { status: 403, headers: noCache });
  }
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
    const current = authorized;
    if (request.signal.aborted) return new Response(null, { status: 204, headers: noCache });
    const result = await writeVaultTextpack({ ...current,
      actorType: editOrigin ? "human" : current.actorType,
      ...commitGuard(request, context, current.actorUserId, false, editOrigin !== null), operationId, relativePath,
      baseRevision: match ? match.slice(1, -1) : null,
      bytes: Buffer.concat(chunks, size),
    });
    return Response.json(result, { status: result.status === "conflict" ? 409 : 200, headers: noCache });
  } catch (error) { return failure(error); }
  finally { reader.releaseLock(); }
}

async function mutateEntry(request: Request, context: Context, kind: "move" | "delete") {
  const authorized = await authorize(request, context, "edit");
  if (authorized instanceof Response) return authorized;
  if (!authorized.fullAccess) return Response.json({ error: "Workspace editing permission is required" }, { status: 403, headers: noCache });
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
    let relativePath: string | undefined;
    if (kind === "move") {
      const parsed = await readBoundedJson<{ relativePath?: unknown }>(request, 4096);
      if ("error" in parsed || !parsed.value || typeof parsed.value.relativePath !== "string") {
        return Response.json({ error: "Send a relativePath for the move" }, { status: 400, headers: noCache });
      }
      relativePath = parsed.value.relativePath;
    }
    const current = authorized;
    if (request.signal.aborted) return new Response(null, { status: 204, headers: noCache });
    const input = { ...current, ...commitGuard(request, context, current.actorUserId, true), operationId, basePath, baseRevision: match.slice(1, -1) };
    const result = kind === "move" ? await moveVaultTextpack({ ...input, relativePath: relativePath! }) : await deleteVaultTextpack(input);
    return Response.json(result, { status: result.status === "conflict" ? 409 : 200, headers: noCache });
  } catch (error) { return failure(error); }
}

export const PATCH = (request: Request, context: Context) => mutateEntry(request, context, "move");
export const DELETE = (request: Request, context: Context) => mutateEntry(request, context, "delete");
