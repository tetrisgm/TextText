import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AT_ALIAS_HEADER } from "@/lib/at-alias";
import { usernameFromAtPath } from "@/lib/public-paths";
import { tenantFromHost } from "@/lib/tenants";

// Host-based multi-tenancy: {handle}.{ROOT_DOMAIN} rewrites to /t/{handle}/...
// so the app router stays plain. The platform site (root domain) passes
// through untouched.

export function proxy(request: NextRequest) {
  const usernamePath = usernameFromAtPath(request.nextUrl.pathname);
  if (usernamePath) {
    const url = request.nextUrl.clone();
    url.pathname = `/u/${usernamePath.username}${usernamePath.rest}`;
    // Mark the rewritten request so /u pages can tell a canonical /@ visit
    // from a direct /u hit (which they redirect back to the /@ URL).
    const headers = new Headers(request.headers);
    headers.set(AT_ALIAS_HEADER, "1");
    return NextResponse.rewrite(url, { request: { headers } });
  }

  const handle = tenantFromHost(request.headers.get("host"));
  if (!handle) return NextResponse.next();

  const url = request.nextUrl.clone();
  // A tenant host asking for /t/... is not a real route; never double-rewrite.
  // Answer 404 directly from the proxy instead of rewriting to a phantom path.
  if (url.pathname.startsWith("/t/")) {
    return new Response("Not found", { status: 404 });
  }
  url.pathname = `/t/${handle}${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Skip Next internals and static assets; everything else may be tenant-routed.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:png|jpg|jpeg|webp|svg|ico|ttf|woff2?)$).*)"],
};
