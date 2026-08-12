import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AT_ALIAS_HEADER } from "@/lib/at-alias";
import { usernameFromAtPath } from "@/lib/public-paths";
import { tenantFromHost } from "@/lib/tenants";
import {
  genericPublicNotFound,
  isPublicOriginRequest,
  sessionlessPublicRequestHeaders,
} from "@/lib/public-origin";
import { getBlog, resolvePublicPostPath } from "@/lib/store";

// Host-based multi-tenancy: {handle}.{ROOT_DOMAIN} rewrites to /t/{handle}/...
// so the app router stays plain. The platform site (root domain) passes
// through untouched.

export async function proxy(request: NextRequest) {
  const usernamePath = usernameFromAtPath(request.nextUrl.pathname);
  if (usernamePath) {
    const privateSegments = usernamePath.rest.split("/").filter(Boolean);
    if (
      privateSegments.length >= 2 &&
      !request.headers.get("cookie") &&
      !request.headers.get("authorization")
    ) {
      return genericPublicNotFound();
    }
    const url = request.nextUrl.clone();
    url.pathname = `/u/${usernamePath.username}${usernamePath.rest}`;
    // Mark the rewritten request so /u pages can tell a canonical /@ visit
    // from a direct /u hit (which they redirect back to the /@ URL).
    const headers = new Headers(request.headers);
    headers.set(AT_ALIAS_HEADER, "1");
    return NextResponse.rewrite(url, { request: { headers } });
  }

  const rootTenantPath = request.nextUrl.pathname.match(
    /^\/t\/[^/]+\/([^/]+)\/(.+)$/,
  );
  if (
    rootTenantPath &&
    !isPublicOriginRequest(request.headers) &&
    !["c", "tags", "public-assets"].includes(rootTenantPath[1] ?? "") &&
    !request.headers.get("cookie") &&
    !request.headers.get("authorization")
  ) {
    return genericPublicNotFound();
  }

  const handle = tenantFromHost(request.headers.get("host"));
  if (!handle) return NextResponse.next();

  const url = request.nextUrl.clone();
  // A tenant host asking for /t/... is not a real route; never double-rewrite.
  // Answer 404 directly from the proxy instead of rewriting to a phantom path.
  if (url.pathname.startsWith("/t/")) {
    if (isPublicOriginRequest(request.headers)) return NextResponse.next();
    return new Response("Not found", { status: 404 });
  }
  const publicPath = url.pathname === "/" ? "" : url.pathname;
  const markdownMatch = publicPath.match(/^\/(.+)\/index\.md$/);
  const ogMatch = publicPath.match(/^\/(.+)\/opengraph-image$/);
  const pathSegments = publicPath.split("/").filter(Boolean);
  if (pathSegments.length === 0) {
    if (!(await getBlog(handle))) return genericPublicNotFound();
  } else if (
    pathSegments.length >= 2 &&
    !markdownMatch &&
    !ogMatch &&
    !["c", "tags", "public-assets"].includes(pathSegments[0] ?? "")
  ) {
    const slug = pathSegments.at(-1) ?? "";
    const folderPath = pathSegments.slice(0, -1).join("/");
    const resolution = await resolvePublicPostPath(handle, folderPath, slug);
    if (resolution.kind === "missing") return genericPublicNotFound();
  }
  url.pathname = markdownMatch
    ? `/t/${handle}/public-assets/markdown/${markdownMatch[1]}`
    : ogMatch
      ? `/t/${handle}/public-assets/og/${ogMatch[1]}`
      : `/t/${handle}${publicPath}`;
  return NextResponse.rewrite(url, {
    request: { headers: sessionlessPublicRequestHeaders(request.headers) },
  });
}

export const config = {
  // Skip Next internals and static assets; everything else may be tenant-routed.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:png|jpg|jpeg|webp|svg|ico|ttf|woff2?)$).*)"],
};
