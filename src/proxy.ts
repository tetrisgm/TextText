import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AT_ALIAS_HEADER } from "@/lib/at-alias";
import { usernameFromAtPath } from "@/lib/public-paths";
import { tenantFromHost } from "@/lib/tenants";

// Host-based multi-tenancy: {handle}.{ROOT_DOMAIN} rewrites to /t/{handle}/...
// so the app router stays plain. The platform site (root domain) passes
// through untouched.
// The legacy product host. write.ramine.net is retired: humans are forwarded to
// the canonical domain (texttext.app), but the operational paths an already
// installed Mac app still hits on the old host stay alive so it is never
// stranded before it auto-updates to the texttext.app build (which then uses
// texttext.app for everything). Remove this block once no client hits the old
// host, then drop the write.ramine.net alias.
const LEGACY_HOSTS = new Set(["write.ramine.net", "www.write.ramine.net"]);

function legacyHostRedirect(request: NextRequest): NextResponse | null {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  if (!LEGACY_HOSTS.has(host)) return null;
  const path = request.nextUrl.pathname;
  const keepOnLegacyHost =
    path.startsWith("/api/") ||
    path.startsWith("/.well-known/") ||
    path === "/appcast.xml" ||
    path.startsWith("/download");
  if (keepOnLegacyHost) return null;
  const target = request.nextUrl.clone();
  target.protocol = "https:";
  target.host = "texttext.app";
  target.port = "";
  // 308 preserves method + body so a redirected non-GET never silently drops.
  return NextResponse.redirect(target, 308);
}

export function proxy(request: NextRequest) {
  const legacyRedirect = legacyHostRedirect(request);
  if (legacyRedirect) return legacyRedirect;

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
