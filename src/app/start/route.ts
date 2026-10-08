import { NextResponse, type NextRequest } from "next/server";
import {
  resolveWorkspaceHomePath,
} from "@/app/editor/actions";
import { getCurrentUser } from "@/lib/session";
import { AccountLinkRequiredError } from "@/lib/store";
import { requestPublicOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

// The signed-in entry point into a workspace: the classic service shape is
// sign in first, then write. Signed-out visitors are routed through /signin
// and come back here. Both the default and ?to=home open the shared file workspace.
// Template links open the shared file template picker without creating a draft.
//
// Real HTTP redirects, on purpose. A link to /start is prefetched by the
// router with a `_rsc` cache-busting parameter; that parameter used to be
// preserved into callbackUrl, and after sign-in the browser navigated to
// /start?_rsc=..., where next/navigation's redirect() answered the way it
// answers a router request (a 200 with redirect headers) and the person saw
// a blank page. NextResponse.redirect is a 307 whatever the URL says.
function go(location: string, request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL(location, requestPublicOrigin(request)), 307);
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    // Preserve the intent (to=home, template, seed) across sign-in, and only
    // that: the router's own parameters are not part of it.
    const query = new URLSearchParams(request.nextUrl.searchParams);
    query.delete("_rsc");
    const target = `/start${query.size ? `?${query.toString()}` : ""}`;
    return go(`/signin?callbackUrl=${encodeURIComponent(target)}`, request);
  }

  try {
    if (request.nextUrl.searchParams.get("to") === "home") {
      return go(await resolveWorkspaceHomePath(), request);
    }
    const templateSlug = request.nextUrl.searchParams.get("template");
    if (templateSlug !== null) {
      if (!/^[a-z][a-z0-9-]{0,80}$/.test(templateSlug)) {
        return go("/templates", request);
      }
      const home = await resolveWorkspaceHomePath();
      return go(`${home}?template=${encodeURIComponent(templateSlug)}`, request);
    }
    return go(await resolveWorkspaceHomePath(), request);
  } catch (error) {
    if (error instanceof AccountLinkRequiredError) {
      return go("/signin?error=AccountLinkRequired", request);
    }
    throw error;
  }
}
