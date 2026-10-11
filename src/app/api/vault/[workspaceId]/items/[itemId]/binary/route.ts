import { createHash } from "node:crypto";
import { authorizeVaultItem, authorizeVaultItemAtPath } from "@/app/api/vault/scoped-auth";
import { readVaultTextpack, writeVaultBinaryEntry, VaultBinaryEntryConflictError, VaultBusyError } from "@/lib/store";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { openPack } from "@/local-vault/pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspaceId: string; itemId: string }> };
const headers = { "Cache-Control": "no-store" };
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function failure(error: unknown): Response {
  if (error instanceof Response) return error;
  if (error instanceof Error && error.name === "AbortError") return new Response(null, { status: 204, headers });
  if (error instanceof VaultBinaryEntryConflictError) return Response.json({ error: error.message, code: "entry_changed" }, { status: 409, headers });
  if (error instanceof VaultBusyError) return Response.json({ error: "Workspace is busy. Retry this operation." }, { status: 503, headers: { ...headers, "Retry-After": "1" } });
  if (error instanceof Error && /missing or deleted/.test(error.message)) return Response.json({ error: "Item not found" }, { status: 404, headers });
  if (error instanceof Error && /reused/.test(error.message)) return Response.json({ error: "Operation identifier was reused" }, { status: 409, headers });
  if (error instanceof Error && /Invalid|exceeds|limit|TextPack/.test(error.message)) return Response.json({ error: "Invalid binary entry" }, { status: 422, headers });
  return Response.json({ error: "Binary entry could not be saved. Retry with the same operation identifier." }, { status: 503, headers });
}

export async function GET(request: Request, context: Context) {
  try {
    const { workspaceId, itemId } = await context.params;
    if (!identifier.test(itemId)) return Response.json({ error: "Invalid item identifier" }, { status: 400, headers });
    const access = await authorizeVaultItem(request, workspaceId, itemId, "read");
    if (access instanceof Response) return access;
    const item = await readVaultTextpack({ ...access, itemId });
    const latest = await authorizeVaultItem(request, workspaceId, itemId, "read");
    if (latest instanceof Response) return latest;
    if (!item || latest.relativePath !== item.relativePath) return Response.json({ error: "Item changed. Retry reading it." }, { status: 409, headers });
    const pack = openPack(item.bytes, item.relativePath, item.revision, itemId);
    const entries = Object.entries(pack.entries).filter(([name]) => name.startsWith(pack.prefix + "assets/") && !name.endsWith("/"));
    const requested = new URL(request.url).searchParams.get("entry");
    if (requested !== null) {
      const match = entries.find(([name]) => name === pack.prefix + requested);
      if (!requested.startsWith("assets/") || !match) return Response.json({ error: "Binary entry not found" }, { status: 404, headers });
      return new Response(new Uint8Array(match[1]), { headers: { ...headers,
        "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff",
        ETag: `"${sha(match[1])}"`, "X-TextText-Revision": item.revision,
      } });
    }
    return Response.json({ revision: item.revision, entries: entries.map(([name, data]) => ({
      path: name.slice(pack.prefix.length), sha256: sha(data), size: data.length,
    })) }, { headers });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { workspaceId, itemId } = await context.params;
    if (!identifier.test(itemId)) return Response.json({ error: "Invalid item identifier" }, { status: 400, headers });
    const access = await authorizeVaultItem(request, workspaceId, itemId, "edit");
    if (access instanceof Response) return access;
    const parsed = await readBoundedJson<unknown>(request, 23 * 1024 * 1024);
    if ("error" in parsed) return Response.json({ error: "Invalid or oversized binary request" }, { status: parsed.error === "too_large" ? 413 : 400, headers });
    const value = parsed.value as Record<string, unknown> | null;
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        typeof value.operationId !== "string" || !identifier.test(value.operationId) ||
        typeof value.entryPath !== "string" ||
        !(value.expectedHash === null || typeof value.expectedHash === "string" && /^[a-f0-9]{64}$/.test(value.expectedHash)) ||
        !(value.expectedLifecycle === null || typeof value.expectedLifecycle === "string" && identifier.test(value.expectedLifecycle)) ||
        !(value.bytesBase64 === null || typeof value.bytesBase64 === "string" && value.bytesBase64.length <= 22 * 1024 * 1024)) {
      return Response.json({ error: "Invalid binary request" }, { status: 400, headers });
    }
    const encoded = value.bytesBase64 as string | null;
    const bytes = encoded === null ? null : Buffer.from(encoded, "base64");
    if (encoded !== null && bytes?.toString("base64") !== encoded) return Response.json({ error: "Invalid binary bytes" }, { status: 400, headers });
    if (request.signal.aborted) return new Response(null, { status: 204, headers });
    const result = await writeVaultBinaryEntry({ ...access, itemId,
      operationId: value.operationId, entryPath: value.entryPath,
      expectedHash: value.expectedHash as string | null,
      expectedLifecycle: value.expectedLifecycle as string | null,
      bytes, signal: request.signal,
      beforeCommit: async relativePath => {
        const latest = await authorizeVaultItemAtPath(request, workspaceId, itemId, relativePath, "edit");
        if (latest instanceof Response) throw latest;
        if (latest.actorUserId !== access.actorUserId) throw Response.json({ error: "Session changed" }, { status: 403, headers });
      },
    });
    return Response.json(result, { headers });
  } catch (error) { return failure(error); }
}
