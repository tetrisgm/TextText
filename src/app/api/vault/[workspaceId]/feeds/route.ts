import { authorizeVaultWorkspaceOrScoped } from "@/app/api/vault/scoped-auth";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { discoverVaultFeeds, readVaultFeed, VaultFeedError } from "@/lib/vault/rss-feed.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
type Context = { params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const access = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
  if (access instanceof Response) return access;
  if (!access.fullAccess) return Response.json({ error: "Workspace read access is required." }, { status: 403, headers });
  const body = await readBoundedJson<{ action?: unknown; address?: unknown; feedURL?: unknown }>(request, 8192);
  if ("error" in body || !body.value || !(
    body.value.action === "discover" && typeof body.value.address === "string" ||
    body.value.action === "read" && typeof body.value.feedURL === "string"
  )) return Response.json({ error: "Choose a feed address to discover or read." }, { status: 400, headers });
  try {
    const result = body.value.action === "discover"
      ? await discoverVaultFeeds(body.value.address as string)
      : await readVaultFeed(body.value.feedURL as string);
    // A shared grant or session may change while a publisher is being fetched.
    const current = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
    if (current instanceof Response) return current;
    if (!current.fullAccess || current.actorUserId !== access.actorUserId) {
      return Response.json({ error: "Workspace read access changed." }, { status: 403, headers });
    }
    if (request.signal.aborted) return new Response(null, { status: 204, headers });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof VaultFeedError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "The feed could not be read. Retry later." }, { status: 503, headers });
  }
}
