// Public reader responses for poll nodes.
//
//   GET  /api/respond?post=<id>&field=<fieldId>   -> the current tally
//   POST /api/respond {post, field, values}       -> record or update a vote
//
// Only a PUBLISHED, PUBLIC post whose pinned template composes a poll node
// over that field accepts responses; everything else is a 404, so drafts and
// private documents do not exist to this route. One response per reader:
// signed-in readers key by user id, anonymous readers by a long-lived
// httpOnly cookie, and re-voting updates the same row. Tallies count only
// labels that are still on the ballot.

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { documentResponses, posts } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/session";
import { getDocumentTemplate } from "@/lib/store";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import {
  findPollNode,
  pollClosed,
  pollOptionLabels,
  validatePollSubmission,
} from "@/lib/documents/responses";
import {
  readResponseAggregate,
  upsertDocumentResponse,
} from "@/lib/documents/responses.server";

export const dynamic = "force-dynamic";

const RESPONDER_COOKIE = "tt_responder";
const MAX_RESPONDERS_PER_POLL = 10_000;

const submissionSchema = z
  .object({
    post: z.string().uuid(),
    field: z.string().regex(/^[a-z][A-Za-z0-9_.-]{0,119}$/),
    values: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  })
  .strict();

async function loadPoll(postId: string, fieldId: string) {
  if (!db) return null;
  const rows = await db
    .select({
      id: posts.id,
      blogId: posts.blogId,
      templateId: posts.templateId,
      templateVersion: posts.templateVersion,
      document: posts.document,
      visibility: posts.visibility,
      status: posts.status,
    })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  const post = rows[0];
  if (!post) return null;
  if (post.visibility !== "public" || post.status !== "published") return null;
  const template = await getDocumentTemplate(post.blogId, {
    id: post.templateId,
    version: post.templateVersion,
  });
  if (!template) return null;
  const poll = findPollNode(template, fieldId);
  if (!poll) return null;
  const document = validateDocumentSnapshot(post.document);
  const labels = pollOptionLabels(document, poll);
  return { post, poll, document, labels };
}

function responderFromRequest(
  request: NextRequest,
  user: { sub: string; userId?: string; name?: string } | null,
): { key: string; name: string | null; minted: string | null } {
  if (user) {
    return { key: `user:${user.userId ?? user.sub}`, name: user.name ?? null, minted: null };
  }
  const existing = request.cookies.get(RESPONDER_COOKIE)?.value;
  if (existing && /^[A-Za-z0-9-]{10,80}$/.test(existing)) {
    return { key: `anon:${existing}`, name: null, minted: null };
  }
  const fresh = randomUUID();
  return { key: `anon:${fresh}`, name: null, minted: fresh };
}

function withResponderCookie(response: NextResponse, minted: string | null) {
  if (minted) {
    response.cookies.set(RESPONDER_COOKIE, minted, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }
  return response;
}

export async function GET(request: NextRequest) {
  const postId = request.nextUrl.searchParams.get("post") ?? "";
  const fieldId = request.nextUrl.searchParams.get("field") ?? "";
  if (!z.string().uuid().safeParse(postId).success || !fieldId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const loaded = await loadPoll(postId, fieldId);
  if (!loaded) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const user = await getCurrentUser();
  const responder = responderFromRequest(request, user);
  const aggregate = await readResponseAggregate({
    postId,
    fieldId,
    labels: loaded.labels,
    responderKey: responder.minted ? null : responder.key,
  });
  return NextResponse.json({
    open: !pollClosed(loaded.document, loaded.poll, new Date()),
    multiple: loaded.poll.multiple === true,
    labels: loaded.labels,
    ...aggregate,
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { post: postId, field: fieldId, values } = parsed.data;
  const loaded = await loadPoll(postId, fieldId);
  if (!loaded) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (pollClosed(loaded.document, loaded.poll, new Date())) {
    return NextResponse.json({ error: "This poll is closed." }, { status: 409 });
  }
  const reason = validatePollSubmission({
    labels: loaded.labels,
    values,
    multiple: loaded.poll.multiple === true,
  });
  if (reason) return NextResponse.json({ error: reason }, { status: 422 });

  const user = await getCurrentUser();
  const responder = responderFromRequest(request, user);
  if (db) {
    const [existing] = await db
      .select({ total: count() })
      .from(documentResponses)
      .where(
        and(
          eq(documentResponses.postId, postId),
          eq(documentResponses.fieldId, fieldId),
        ),
      );
    if ((existing?.total ?? 0) >= MAX_RESPONDERS_PER_POLL) {
      return NextResponse.json({ error: "This poll is full." }, { status: 429 });
    }
  }
  await upsertDocumentResponse({
    postId,
    fieldId,
    responderKey: responder.key,
    responderName: responder.name,
    values,
  });
  const aggregate = await readResponseAggregate({
    postId,
    fieldId,
    labels: loaded.labels,
    responderKey: responder.key,
  });
  return withResponderCookie(
    NextResponse.json({
      open: true,
      multiple: loaded.poll.multiple === true,
      labels: loaded.labels,
      ...aggregate,
    }),
    responder.minted,
  );
}
