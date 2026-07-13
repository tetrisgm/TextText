// Session-authed workspace change feed for the in-app workspace view.
//
// The Mac native sync engine long-polls /api/sync/v1/changes (bearer wsk_
// token) to know when to run a pass. The web workspace view is session-authed
// and needs the same signal so it refreshes when content changes underneath
// it: a file the native engine pushed, a shared item, a change from another
// device, or an MCP edit. This mirrors that route's long-poll over the same
// workspaceChangeCursor, but authorizes by session + workspace ownership.
//
//   GET /api/workspace/changes?handle=H                 -> immediate {cursor}
//   GET /api/workspace/changes?handle=H&cursor=X&wait=20 -> holds up to `wait`
//        seconds, returns as soon as the cursor moves past X, else on timeout.
import { getCurrentUser } from "@/lib/session";
import { resolveWorkspaceAccess } from "@/lib/permissions";
import { workspaceChangeCursor } from "@/lib/sync-cursor";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_WAIT_SECONDS = 25;
const POLL_INTERVAL_MS = 750;

// A value that changes on every deployment, so a long-running client can
// notice it is on stale code and reload itself (no more manual Cmd-R).
const BUILD =
  process.env.VERCEL_DEPLOYMENT_ID ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  "dev";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle")?.trim();
  if (!handle) return jsonError("Missing workspace handle", 400);

  const user = await getCurrentUser();
  const access = await resolveWorkspaceAccess({ handle, user });
  if (!access.isOwner) return jsonError("Workspace not found", 404);

  const since = url.searchParams.get("cursor");
  const wait = Math.min(
    Math.max(Number(url.searchParams.get("wait")) || 0, 0),
    MAX_WAIT_SECONDS,
  );

  let cursor = await workspaceChangeCursor(handle);
  if (!since || wait === 0) {
    return Response.json(
      { cursor, changed: since ? cursor !== since : false, build: BUILD },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const deadline = Date.now() + wait * 1000;
  while (cursor === since && Date.now() < deadline) {
    if (request.signal?.aborted) break;
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));
    cursor = await workspaceChangeCursor(handle);
  }
  return Response.json(
    { cursor, changed: cursor !== since, build: BUILD },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
