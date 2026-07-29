// Reader-response persistence for poll nodes. One row per (post, field,
// responder); re-voting updates in place, so tallies count readers, never
// submissions. All access goes through here so the public route, the MCP
// tool, and any future digest share one query shape.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { documentResponses } from "@/lib/db/schema";
import type { PollAggregate } from "./responses";

export async function upsertDocumentResponse({
  postId,
  fieldId,
  responderKey,
  responderName,
  values,
}: {
  postId: string;
  fieldId: string;
  responderKey: string;
  responderName: string | null;
  values: string[];
}): Promise<void> {
  if (!db) throw new Error("Responses require a database.");
  await db
    .insert(documentResponses)
    .values({ postId, fieldId, responderKey, responderName, values })
    .onConflictDoUpdate({
      target: [
        documentResponses.postId,
        documentResponses.fieldId,
        documentResponses.responderKey,
      ],
      set: {
        values,
        responderName,
        updatedAt: sql`now()`,
      },
    });
}

/** Tally by option label against the CURRENT labels, so renamed or removed
 * options simply stop counting. The viewer's own selection rides along for
 * "you voted" rendering. */
export async function readResponseAggregate({
  postId,
  fieldId,
  labels,
  responderKey,
}: {
  postId: string;
  fieldId: string;
  labels: string[];
  responderKey: string | null;
}): Promise<PollAggregate> {
  const counts: Record<string, number> = {};
  for (const label of labels) counts[label] = 0;
  if (!db) return { total: 0, counts, viewer: null };
  const rows = await db
    .select({
      responderKey: documentResponses.responderKey,
      values: documentResponses.values,
    })
    .from(documentResponses)
    .where(
      and(
        eq(documentResponses.postId, postId),
        eq(documentResponses.fieldId, fieldId),
      ),
    );
  let total = 0;
  let viewer: string[] | null = null;
  for (const row of rows) {
    const chosen = (row.values ?? []).filter((value) => value in counts);
    if (chosen.length > 0) total += 1;
    for (const value of chosen) counts[value] += 1;
    if (responderKey && row.responderKey === responderKey) viewer = chosen;
  }
  return { total, counts, viewer };
}

/** Individual responses for workspace members (the MCP surface). Responder
 * keys are opaque; names exist only for signed-in responders. */
export async function listDocumentResponses(postId: string): Promise<
  {
    fieldId: string;
    responderName: string | null;
    signedIn: boolean;
    values: string[];
    updatedAt: Date;
  }[]
> {
  if (!db) return [];
  const rows = await db
    .select({
      fieldId: documentResponses.fieldId,
      responderKey: documentResponses.responderKey,
      responderName: documentResponses.responderName,
      values: documentResponses.values,
      updatedAt: documentResponses.updatedAt,
    })
    .from(documentResponses)
    .where(eq(documentResponses.postId, postId))
    .orderBy(documentResponses.updatedAt);
  return rows.map((row) => ({
    fieldId: row.fieldId,
    responderName: row.responderName,
    signedIn: row.responderKey.startsWith("user:"),
    values: row.values ?? [],
    updatedAt: row.updatedAt,
  }));
}
