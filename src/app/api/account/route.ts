/**
 * The signed-in person's own account: what deleting it would destroy, and
 * deleting it.
 *
 * A route handler rather than a Server Action, for the same reason the Trash
 * mutations are: a Server Action reference is build-specific, so an open Mac
 * window holding one stops working the moment a deploy lands, while ordinary
 * JSON keeps working. Account deletion is the most consequential thing a
 * long-lived WKWebView window can invoke, so it takes the transport that
 * survives a deploy.
 */

import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import {
  executeAccountDeletion,
  getAccountDeletionSummary,
} from "@/lib/account-deletion";
import { appSessionCookieName } from "@/lib/app-session";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// The purge walks every document, folder and audit row of a workspace and
// makes network calls to blob storage. The default budget is not enough.
export const maxDuration = 60;

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: PRIVATE });
}

/**
 * Fails closed at every step, and identically at each one: demo mode, a
 * signed-out visitor, and a collaborator who owns no workspace are all a 404,
 * so this endpoint never confirms that some other account exists.
 */
async function ownerSub(): Promise<string | null> {
  if (!isAuthConfigured) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  return user.sub;
}

export async function GET(): Promise<NextResponse> {
  const sub = await ownerSub();
  if (!sub) return jsonError("Not found", 404);
  const summary = await getAccountDeletionSummary(sub);
  if (!summary) return jsonError("Not found", 404);
  return NextResponse.json(
    {
      email: summary.email,
      username: summary.username,
      handle: summary.handle,
      workspaceName: summary.workspaceName,
      documents: summary.documents,
      publishedDocuments: summary.publishedDocuments,
      collaborators: summary.collaborators,
      apiTokens: summary.apiTokens,
      hasCloudAiKey: summary.hasCloudAiKey,
      // What the person must type. Sent so the field can label itself, NOT so
      // the client can decide: the server re-derives and re-checks it below.
      confirmationPhrase: summary.email ?? summary.username ?? summary.handle,
    },
    { headers: PRIVATE },
  );
}

function cleanText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${label}`);
  }
  return value.trim();
}

/**
 * Clears the session in this same response rather than calling signOut. Inside
 * a WKWebView an expiring Set-Cookie here is deterministic, where a second
 * round trip through a session that no longer resolves is not. Both names are
 * cleared because the secure prefix depends on the deployment.
 */
function clearSession(response: NextResponse): NextResponse {
  for (const secure of [true, false]) {
    response.cookies.set({
      name: appSessionCookieName(secure),
      value: "",
      path: "/",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
      secure,
    });
  }
  return response;
}

export async function POST(request: Request): Promise<NextResponse> {
  const sub = await ownerSub();
  if (!sub) return jsonError("Not found", 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request", 400);
  }
  const input = (body ?? {}) as Record<string, unknown>;
  let confirmation: string;
  try {
    if (cleanText(input.operation, "operation") !== "delete-account") {
      return jsonError("Invalid request", 400);
    }
    confirmation = cleanText(input.confirmation, "confirmation");
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Invalid request",
      400,
    );
  }

  const summary = await getAccountDeletionSummary(sub);
  if (!summary) return jsonError("Not found", 404);

  // Re-derived from the session, never taken from the request. The disabled
  // button in the dialog is a courtesy; this is the gate.
  const expected = summary.email ?? summary.username ?? summary.handle;
  if (confirmation.trim().toLowerCase() !== expected.trim().toLowerCase()) {
    return jsonError("That does not match", 400);
  }

  const outcome = await executeAccountDeletion(summary);

  // complete=false means CLOSE committed and the purge did not finish. The
  // account is already closed and unusable, so this is a success with work
  // still owed, not a failure: signing in again resumes it.
  return clearSession(
    NextResponse.json(
      { ok: true, complete: outcome.complete },
      { headers: PRIVATE },
    ),
  );
}
