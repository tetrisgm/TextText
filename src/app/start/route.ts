import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import {
  createStarterDraftPath,
  createTemplateDraftPath,
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
    // Preserve the whole intent (to=home, template, seed) across sign-in.
    const query = request.nextUrl.searchParams.toString();
    const target = `/start${query ? `?${query}` : ""}`;
    redirect(`/signin?callbackUrl=${encodeURIComponent(target)}`);
  }

  if (request.nextUrl.searchParams.get("to") === "home") {
    redirect(await resolveWorkspaceHomePath());
  }
  const templateSlug = request.nextUrl.searchParams.get("template");
  if (templateSlug && /^[a-z][a-z0-9-]{0,80}$/.test(templateSlug)) {
    redirect(
      await createTemplateDraftPath(
        templateSlug,
        request.nextUrl.searchParams.get("seed") === "1",
      ),
    );
  }
  redirect(await createStarterDraftPath());
}
