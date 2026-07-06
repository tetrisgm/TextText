import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import {
  createStarterDraftPath,
  resolveWorkspaceHomePath,
} from "@/app/editor/actions";
import { deleteAllGuestEditCookies } from "@/lib/blog-edit-auth";

export const dynamic = "force-dynamic";

// The single entry point into a workspace. Signed-in users land in their own
// blog, claiming the browser's guest workspace on the way when they have one;
// guests get (or resume) a cookie-bound workspace. ?to=home lands on the blog
// home (the claim journey); the default lands in a ready-to-edit first draft.
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("fresh") === "1") {
    await deleteAllGuestEditCookies();
  }
  if (request.nextUrl.searchParams.get("to") === "home") {
    redirect(await resolveWorkspaceHomePath());
  }
  redirect(await createStarterDraftPath());
}
