import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { tenantFromHost } from "@/lib/tenants";

// Host-based multi-tenancy: {handle}.{ROOT_DOMAIN} rewrites to /t/{handle}/...
// so the app router stays plain. The platform site (root domain) passes
// through untouched. Locally, http://demo.localhost:3000 exercises this.
export function proxy(request: NextRequest) {
  const handle = tenantFromHost(request.headers.get("host"));
  if (!handle) return NextResponse.next();

  const url = request.nextUrl.clone();
  // Never double-rewrite (a tenant host asking for /t/... is not a real route).
  if (url.pathname.startsWith("/t/")) {
    url.pathname = "/404";
    return NextResponse.rewrite(url);
  }
  url.pathname = `/t/${handle}${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Skip Next internals and static assets; everything else may be tenant-routed.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:png|jpg|jpeg|webp|svg|ico|ttf|woff2?)$).*)"],
};
