import { z } from "zod";
import { authorizeVaultWorkspaceOrScoped } from "@/app/api/vault/scoped-auth";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { validVaultFolderPath } from "@/lib/vault/folder-identity";
import { createWorkspaceWriteProposal } from "@/lib/ai/write-proposals.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const folder = z.string().min(1).max(256).refine(validVaultFolderPath);
const bodySchema = z.object({ source: folder, destination: folder, stagingKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional() }).strict();
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

/** First-party menu action. Staging freezes the server's plan; only the existing
 * owner review can approve it. No filesystem write happens in this route. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const access = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
  if (access instanceof Response) return access;
  if (!access.canManageShares || !access.actorSub) return fail(403, "Only the workspace owner can move folders.");
  const decoded = await readBoundedJson(request, 2_000);
  if ("error" in decoded) return fail(decoded.error === "too_large" ? 413 : 400, "Choose a source folder and destination.");
  const body = bodySchema.safeParse(decoded.value);
  if (!body.success) return fail(400, "Choose a source folder and destination.");
  try {
    const proposal = await createWorkspaceWriteProposal({
      actor: { sub: access.actorSub, userId: access.actorUserId, handle: access.workspaceHandle,
        actorType: "human", connectionId: `app:${access.actorUserId}` },
      tool: "move_folder_tree",
      ...(body.data.stagingKey ? { stagingKey: body.data.stagingKey } : {}),
      arguments: { source_path: body.data.source, destination_path: body.data.destination, idempotency_key: body.data.stagingKey ?? crypto.randomUUID() },
    });
    return Response.json({ proposal, reviewPath: `/proposals/${proposal.id}` }, { status: 201, headers });
  } catch {
    return fail(409, "That folder move could not be prepared. Refresh the folder and try again.");
  }
}
