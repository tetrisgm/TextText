import { z } from "zod";
import { decideAssistantProposal } from "@/lib/ai/assistant-proposal-decisions.server";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { getCurrentUser } from "@/lib/session";
import { getOwnedBlog, getUserIdBySub } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_DECISION_BODY_BYTES = 2_000;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;
const proposalIdSchema = z.string().uuid();
const decisionSchema = z
  .object({ decision: z.enum(["approve", "deny"]) })
  .strict();

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return response({ error: "Sign in to review this change." }, 401);
  const blog = await getOwnedBlog(user.sub);
  if (!blog) return response({ error: "No workspace is connected." }, 403);
  const proposalId = proposalIdSchema.safeParse((await params).id);
  if (!proposalId.success) {
    return response({ error: "That proposed change is invalid." }, 400);
  }
  const decoded = await readBoundedJson(request, MAX_DECISION_BODY_BYTES);
  if ("error" in decoded) {
    return decoded.error === "too_large"
      ? response({ error: "That approval request is too large." }, 413)
      : response({ error: "Send a valid approval request." }, 400);
  }
  const decision = decisionSchema.safeParse(decoded.value);
  if (!decision.success) {
    return response(
      { error: "Choose approve or deny without changing the proposal." },
      400,
    );
  }
  const userId = user.userId ?? await getUserIdBySub(user.sub);
  if (!userId) return response({ error: "No account is connected." }, 403);

  const result = await decideAssistantProposal({
    actor: { sub: user.sub, userId, handle: blog.handle },
    proposalId: proposalId.data,
    decision: decision.data.decision,
  });
  switch (result.status) {
    case "completed":
      return response({ receipt: result.receipt });
    case "denied":
      return response({ proposalId: result.proposalId, status: "denied" });
    case "ambiguous":
      return response({
        proposalId: result.proposalId,
        status: "ambiguous",
        message: result.message,
      }, 202);
    case "expired":
      return response({ error: "That proposed change has expired." }, 410);
    case "already_used":
      return response(
        { error: "That proposed change has already been decided." },
        409,
      );
    case "not_found":
      return response({ error: "That proposed change was not found." }, 404);
    case "failed":
      return response({ error: result.message }, 422);
  }
}
