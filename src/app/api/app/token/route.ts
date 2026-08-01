import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthConfigured } from "@/auth";
import { mintAppTokenForUser } from "@/lib/app-token";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// The desktop app's web view calls this in the background right after sign-in:
// one session both authenticates the window and mints the sync token, so there
// is no visible link step. The custom header is required so a cross-site page
// cannot silently mint a token against a logged-in session (a plain form/img
// POST cannot set it, and setting it cross-origin trips a CORS preflight we
// never answer); the session cookie does the actual authentication.
export async function POST(request: NextRequest) {
  if (request.headers.get("x-texttext-app") !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isAuthConfigured) {
    return NextResponse.json(
      { error: "Sign-in is not configured" },
      { status: 503 },
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const device = request.headers.get("x-texttext-device") ?? "this Mac";
  const result = await mintAppTokenForUser(user, device);
  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
