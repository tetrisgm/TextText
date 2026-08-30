import { getCurrentUser } from "@/lib/session";
import { searchAccessibleWorkspaceBodies } from "@/lib/store";
import {
  rankSearchText,
  searchExcerpt,
  workspaceSearchTokens,
  type WorkspaceDeepSearchMatch,
} from "@/lib/workspace-search";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle")?.trim();
  const query = url.searchParams.get("query")?.trim() ?? "";
  if (!handle) return jsonError("Missing workspace handle", 400);
  if (query.length < 3 || query.length > 200) {
    return jsonError("Search query must be between 3 and 200 characters", 400);
  }

  const tokens = workspaceSearchTokens(query);
  if (tokens.length === 0) return Response.json({ matches: [] });
  const candidates = await searchAccessibleWorkspaceBodies(
    handle,
    await getCurrentUser(),
    tokens,
  );
  const matches: WorkspaceDeepSearchMatch[] = candidates
    .flatMap((candidate) => {
      const score = rankSearchText(candidate.title, candidate.body, query);
      return score === null
        ? []
        : [
            {
              postId: candidate.postId,
              detail: searchExcerpt(candidate.body, query),
              score,
            },
          ];
    })
    .sort((left, right) => left.score - right.score)
    .slice(0, 24);

  return Response.json(
    { matches },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
