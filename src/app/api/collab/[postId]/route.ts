// Realtime co-editing relay for one post.
//
//   POST /api/collab/{postId}  {updates: base64[], epoch}  -> {seq, epoch} | {retired, epoch}
//   GET  /api/collab/{postId}?since=N&wait=25              -> {updates, seq, epoch}
//
// GET long-polls: it returns immediately when there are updates newer than
// `since`, otherwise it holds up to `wait` seconds for one to arrive, then
// returns the current seq with an empty list. Auth is the caller's session
// (co-editors are always signed-in users); collabAccess enforces owner/editor
// for pushes and owner/editor/viewer for reads.
//
// Every append is fenced on the epoch and server-owned baseline the client
// caught up under. A push against a retired epoch is rejected instead of being
// merged over an out-of-band write.

import * as Y from "yjs";
import {
  appendCollabUpdate,
  collabUpdatesSince,
  getCollabBaseline,
  getCollabEpoch,
  latestCollabSeq,
  maybeCompactCollab,
  prepareCollabBaseline,
} from "@/lib/collab";
import { getCollabRequestAccess } from "@/lib/collab/access.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_WAIT_SECONDS = 25;
const POLL_INTERVAL_MS = 700;
// Ceiling for the backoff during a long-poll wait, so an idle open editor keeps
// far fewer DB round-trips than a flat 700ms poll would.
const POLL_MAX_INTERVAL_MS = 4000;
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
  const { role } = await getCollabRequestAccess(request, postId);
  if (role !== "editor") {
    return Response.json({ error: "Not an editor of this post" }, { status: 403 });
  }

  let body: { updates?: unknown; epoch?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body" }, { status: 400 });
  }
  // The epoch the client caught up under. Absent (an old client) means epoch 0,
  // which is correct for any post that has never been retired.
  const clientEpoch =
    typeof body.epoch === "number" && Number.isInteger(body.epoch) && body.epoch >= 0
      ? body.epoch
      : 0;
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
    return Response.json({ seq: await latestCollabSeq(postId, clientEpoch), epoch: clientEpoch });
  }

  let seq = 0;
  for (const update of clean) {
    const result = await appendCollabUpdate(postId, update, clientEpoch);
    if ("retired" in result) {
      // The generation moved under this client (its log was retired while it was
      // offline/lapsed). Reject the whole push so its stale edits never merge
      // into the new epoch over an external write; the client reseeds.
      return Response.json({ retired: true, epoch: await getCollabEpoch(postId) });
    }
    seq = result.seq;
  }
  // Keep the append log from growing without bound: once it is large, collapse
  // it to a single equivalent snapshot. Safe to run inline and best-effort.
  await maybeCompactCollab(postId).catch(() => {});
  return Response.json({ seq, epoch: clientEpoch });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const { postId } = await ctx.params;
  const { role } = await getCollabRequestAccess(request, postId);
  if (!role) {
    return Response.json({ error: "No access to this post" }, { status: 403 });
  }

  const url = new URL(request.url);
  const since = Math.max(Number(url.searchParams.get("since")) || 0, 0);
  const wait = Math.min(
    Math.max(Number(url.searchParams.get("wait")) || 0, 0),
    MAX_WAIT_SECONDS,
  );

  const baseline =
    since === 0
      ? await prepareCollabBaseline(postId)
      : await getCollabBaseline(postId);
  if (!baseline) {
    return Response.json({ error: "Document baseline unavailable" }, { status: 409 });
  }
  const epoch = baseline.epoch;

  let updates = await collabUpdatesSince(postId, since, epoch);
  if (updates.length === 0 && wait > 0) {
    const deadline = Date.now() + wait * 1000;
    // Back off the inner DB poll during the wait: snappy for the first checks
    // (a real co-edit still lands in well under a second) then slower while idle,
    // so a long-lived open editor is not a steady stream of Neon queries.
    let interval = POLL_INTERVAL_MS;
    while (updates.length === 0 && Date.now() < deadline) {
      if (request.signal?.aborted) break;
      await sleep(Math.min(interval, Math.max(deadline - Date.now(), 0)));
      updates = await collabUpdatesSince(postId, since, epoch);
      interval = Math.min(Math.round(interval * 1.6), POLL_MAX_INTERVAL_MS);
    }
  }
  const seq = updates.length > 0 ? updates[updates.length - 1].seq : since;
  return Response.json({
    updates,
    seq,
    epoch,
    ...(since === 0
      ? { baseline: { update: baseline.update, revision: baseline.revision } }
      : {}),
  });
}
