// Realtime co-editing relay for one post.
//
//   POST /api/collab/{postId}  {updates: base64[]}   -> {seq}   (editors only)
//   GET  /api/collab/{postId}?since=N&wait=25         -> {updates, seq}
//
// GET long-polls: it returns immediately when there are updates newer than
// `since`, otherwise it holds up to `wait` seconds for one to arrive, then
// returns the current seq with an empty list. Auth is the caller's session
// (co-editors are always signed-in users); collabAccess enforces owner/editor
// for pushes and owner/editor/viewer for reads.

import * as Y from "yjs";
import { getCurrentUser } from "@/lib/session";
import {
  appendCollabUpdate,
  collabAccess,
  collabUpdatesSince,
  latestCollabSeq,
  maybeCompactCollab,
} from "@/lib/collab";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_WAIT_SECONDS = 25;
const POLL_INTERVAL_MS = 700;
const MAX_UPDATES_PER_POST = 64;
// A single Yjs update is a small binary diff; 512 KB base64 is already far
// larger than any real edit, so anything bigger is rejected rather than
// stored forever in the append log.
const MAX_UPDATE_CHARS = 512 * 1024;

// Reject a base64 string that is not a well-formed Yjs update: a stored
// garbage update would throw in every peer's Y.applyUpdate and, because the
// poll only advances past applied updates, poison the document permanently.
function isValidYjsUpdate(base64: string): boolean {
  if (base64.length > MAX_UPDATE_CHARS) return false;
  try {
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0) return false;
    Y.applyUpdate(new Y.Doc(), new Uint8Array(bytes));
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const { postId } = await ctx.params;
  const user = await getCurrentUser();
  const role = await collabAccess(user, postId);
  if (role !== "editor") {
    return Response.json({ error: "Not an editor of this post" }, { status: 403 });
  }

  let body: { updates?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body" }, { status: 400 });
  }
  const updates = Array.isArray(body.updates) ? body.updates : [];
  const candidates = updates
    .filter((u): u is string => typeof u === "string" && u.length > 0)
    .slice(0, MAX_UPDATES_PER_POST);
  // Drop anything that is oversized or not a decodable Yjs update, so the
  // append log can only ever hold updates every peer can safely apply.
  const clean = candidates.filter(isValidYjsUpdate);
  if (clean.length !== candidates.length) {
    return Response.json({ error: "Invalid update payload" }, { status: 400 });
  }
  if (clean.length === 0) {
    return Response.json({ seq: await latestCollabSeq(postId) });
  }

  let seq = 0;
  for (const update of clean) {
    seq = await appendCollabUpdate(postId, update);
  }
  // Keep the append log from growing without bound: once it is large, collapse
  // it to a single equivalent snapshot. Safe to run inline and best-effort.
  await maybeCompactCollab(postId).catch(() => {});
  return Response.json({ seq });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const { postId } = await ctx.params;
  const user = await getCurrentUser();
  const role = await collabAccess(user, postId);
  if (!role) {
    return Response.json({ error: "No access to this post" }, { status: 403 });
  }

  const url = new URL(request.url);
  const since = Math.max(Number(url.searchParams.get("since")) || 0, 0);
  const wait = Math.min(
    Math.max(Number(url.searchParams.get("wait")) || 0, 0),
    MAX_WAIT_SECONDS,
  );

  let updates = await collabUpdatesSince(postId, since);
  if (updates.length === 0 && wait > 0) {
    const deadline = Date.now() + wait * 1000;
    while (updates.length === 0 && Date.now() < deadline) {
      if (request.signal?.aborted) break;
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));
      updates = await collabUpdatesSince(postId, since);
    }
  }
  const seq = updates.length > 0 ? updates[updates.length - 1].seq : since;
  return Response.json({ updates, seq });
}
