import { getCurrentUser } from "@/lib/session";
import { getWorkspacePoolForOwner } from "@/lib/pool/server";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle")?.trim();
  if (!handle) return jsonError("Missing workspace handle", 400);

  const user = await getCurrentUser();
  const pool = await getWorkspacePoolForOwner(handle, user);
  if (!pool) return jsonError("Workspace not found", 404);

  return Response.json(pool, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
