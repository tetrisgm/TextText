/** Internal marker added only after a workspace host crosses the public proxy. */
export const PUBLIC_ORIGIN_HEADER = "x-texttext-public-origin";

const VIEWER_CREDENTIAL_HEADERS = [
  "authorization",
  "cookie",
  "x-forwarded-authorization",
] as const;

/**
 * A workspace subdomain is a sessionless publication surface. Strip every
 * viewer credential before the rewrite reaches an App Router route, then mark
 * the request so the route can avoid even attempting private resolution.
 */
export function sessionlessPublicRequestHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of VIEWER_CREDENTIAL_HEADERS) headers.delete(name);
  headers.set(PUBLIC_ORIGIN_HEADER, "1");
  return headers;
}

export function isPublicOriginRequest(
  headers: Pick<Headers, "get">,
): boolean {
  return headers.get(PUBLIC_ORIGIN_HEADER) === "1";
}

export function genericPublicNotFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
