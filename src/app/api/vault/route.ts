import { authorizeVault } from "./auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorized = await authorizeVault(request);
  if (authorized instanceof Response) return authorized;
  return Response.json({ workspaceId: authorized.workspaceId, name: authorized.name }, {
    headers: { "Cache-Control": "no-store" },
  });
}
