// The externally visible origin of this deployment.
//
// Behind Vercel the request URL is the internal one, so every absolute URL we
// advertise (OAuth metadata, the MCP endpoint, resource_metadata challenges)
// has to be built from the forwarded headers or it leaks an internal host into
// a client's saved configuration.

export function publicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}
