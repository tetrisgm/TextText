// Near-instant sync: long-poll for workspace changes.
//
//   GET /api/sync/v1/changes                 -> immediate {cursor}
//   GET /api/sync/v1/changes?cursor=X&wait=25 -> holds up to `wait` seconds,
//       returning {cursor, changed:true} the moment the workspace's change
//       cursor moves past X, or {cursor:X', changed:false} on timeout.
//
// The client loop is: poll with the last cursor; on changed, run a sync pass
// and poll again with the new cursor. The cursor is opaque; compare only by
// inequality. Wait is capped WELL below the platform function timeout, and
// the poll interval keeps the held request nearly idle (one cheap SQL every
// 2s), which is what makes long-polling affordable on serverless compute.

import { workspaceChangeCursor } from "@/lib/sync-cursor";
import { resolveSyncWorkspace } from "../auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_WAIT_SECONDS = 25;
const POLL_INTERVAL_MS = 750;
// Ceiling for the backoff during a long-poll wait. A few seconds of change-
// detection latency is fine for file sync, and it keeps an always-connected
// File Provider from being a steady stream of Neon queries.
const POLL_MAX_INTERVAL_MS = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: Request) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog } = workspace;

  const url = new URL(request.url);
  const since = url.searchParams.get("cursor");
  const wait = Math.min(
    Math.max(Number(url.searchParams.get("wait")) || 0, 0),
    MAX_WAIT_SECONDS,
  );

  let cursor = await workspaceChangeCursor(blog.handle);
  if (!since || wait === 0) {
    return Response.json({ cursor, changed: since ? cursor !== since : false });
  }

  const deadline = Date.now() + wait * 1000;
  let interval = POLL_INTERVAL_MS;
  while (cursor === since && Date.now() < deadline) {
    // Stop burning cycles for a client that already went away.
    if (request.signal?.aborted) break;
    await sleep(Math.min(interval, Math.max(deadline - Date.now(), 0)));
    cursor = await workspaceChangeCursor(blog.handle);
    interval = Math.min(Math.round(interval * 1.6), POLL_MAX_INTERVAL_MS);
  }
  return Response.json({ cursor, changed: cursor !== since });
}
