import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createStarterDraftPath } from "@/app/editor/actions";
import { deleteAllGuestEditCookies } from "@/lib/blog-edit-auth";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// Start writing without an account: a demo workspace bound to this browser.
// It is a real workspace (same editor, same folders); signing in later
// claims it, so nothing written here is lost by creating an account.
// Signed-in users have no use for the sandbox and go to their workspace.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (user) redirect("/start");

  if (request.nextUrl.searchParams.get("fresh") === "1") {
    await deleteAllGuestEditCookies();
  }
  redirect(await createStarterDraftPath());
}
