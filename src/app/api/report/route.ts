import { fileContentReport } from "@/lib/store";
import { sendContentReportEmail } from "@/lib/moderation-email";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Files a content report. No session required, which is the point: the people
 * reading public pages are signed out, and a report mechanism that demands an
 * account is not one.
 *
 * Abuse posture, in order of what actually protects the queue: the honeypot
 * disqualifies form-filling bots, the length caps bound each row, and review
 * is a human for whom fifty junk rows are an annoyance rather than an outage.
 * A report endpoint that can reject too eagerly is worse than one that accepts
 * some junk, because the cost of a dropped real report is someone's real
 * problem staying published.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const input = (body ?? {}) as Record<string, unknown>;

  // A filled honeypot is a bot. Answer as if it worked so it does not learn.
  if (typeof input.website === "string" && input.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const path = typeof input.path === "string" ? input.path.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const doc = typeof input.doc === "string" ? input.doc.trim() : "";

  // Site-relative only: this column feeds a human's review queue, and a full
  // URL to elsewhere is either a mistake or an attempt to use the queue as a
  // link-delivery channel.
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 512) {
    return NextResponse.json({ error: "A page path is required" }, { status: 400 });
  }
  if (reason.length < 10 || reason.length > 2000) {
    return NextResponse.json(
      { error: "Say what is wrong in 10 to 2000 characters" },
      { status: 400 },
    );
  }

  const report = await fileContentReport({
    path,
    postId: doc || undefined,
    reason,
    reporterEmail: email || undefined,
  });
  if (!report) {
    return NextResponse.json({ error: "Reports are unavailable" }, { status: 503 });
  }

  // Best effort; the row above is the system of record.
  await sendContentReportEmail({
    path,
    reason,
    reporterEmail: email || undefined,
    reportId: report.id,
  });

  return NextResponse.json({ ok: true });
}
