import { getWorkspaceAiSettingsAction, saveWorkspaceAiSettingsAction, removeWorkspaceAiSettingsAction } from "@/app/editor/ai-config-actions";
import { requestPublicOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const failure = (status: number) => Response.json({ error: "AI settings are unavailable." }, { status, headers });
function handle(request: Request) { return new URL(request.url).searchParams.get("handle") ?? ""; }
export async function GET(request: Request) {
  const status = await getWorkspaceAiSettingsAction(handle(request));
  return Response.json(status, { status: status.allowed ? 200 : 403, headers });
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== requestPublicOrigin(request)) return failure(403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return failure(415);
  try {
    const reader = request.body?.getReader();
    if (!reader) return failure(400);
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2048) { await reader.cancel(); return failure(413); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) return failure(400);
    const allowed = body.action === "remove" ? ["action"] : body.action === "save" ? ["action", "provider", "model", "apiKey"] : [];
    if (!allowed.length || Object.keys(body).some(key => !allowed.includes(key))) return failure(400);
    const workspace = handle(request);
    const current = await getWorkspaceAiSettingsAction(workspace);
    if (!current.allowed) return failure(403);
    const status = body.action === "remove" ? await removeWorkspaceAiSettingsAction(workspace) : await saveWorkspaceAiSettingsAction(workspace, body.provider, body.model, body.apiKey);
    return Response.json(status, { headers });
  } catch { return failure(400); }
}
