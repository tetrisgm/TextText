import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import {
  createStarterDraftPath,
  resolveWorkspaceHomePath,
} from "@/app/editor/actions";
import { deleteAllGuestEditCookies } from "@/lib/blog-edit-auth";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// The signed-in entry point into a workspace: the classic service shape is
// sign in first, then write. Signed-out visitors are routed through /signin
// and come back here; a guest workspace from /try gets CLAIMED on the way in,
// so demo work survives signing up. ?to=home lands on the blog home; the
// default lands in a ready-to-edit first draft. Trying without an account
// lives at /try, not here.
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("fresh") === "1") {
    await deleteAllGuestEditCookies();
  }

  const user = await getCurrentUser();
  if (!user) {
    const to = request.nextUrl.searchParams.get("to") === "home" ? "?to=home" : "";
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/start${to}`)}`);
  }

  if (request.nextUrl.searchParams.get("to") === "home") {
    redirect(await resolveWorkspaceHomePath());
  }
  redirect(await createStarterDraftPath());
}
