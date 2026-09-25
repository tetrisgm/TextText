import { isLoopbackHost } from "@/lib/loopback-host";
import { rootDomainUrl } from "@/lib/site-url";
import { TENANT_HANDLE_RE } from "@/lib/tenants";

function deploymentOrigin(): URL {
  for (const value of [
    process.env.AUTH_URL,
    process.env.TEXTTEXT_PRODUCT_ORIGIN,
    process.env.NEXTAUTH_URL,
    rootDomainUrl().origin,
  ]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) {
        return new URL(url.origin);
      }
    } catch {
      // A malformed override must not make request headers authoritative.
    }
  }
  return new URL("https://texttext.app");
}

function hostUrl(value: string | null, protocol: string): URL | null {
  if (!value || /[\s,\\/@?#]/.test(value)) return null;
  try {
    const url = new URL(`${protocol}//${value}`);
    return url.pathname === "/" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function allowedHost(candidate: URL, root: URL): boolean {
  if (candidate.host === root.host) return true;
  if (candidate.port !== root.port) return false;
  if (candidate.hostname === `www.${root.hostname}`) return true;
  const suffix = `.${root.hostname}`;
  return candidate.hostname.endsWith(suffix) &&
    TENANT_HANDLE_RE.test(candidate.hostname.slice(0, -suffix.length));
}

/**
 * Next's standalone server may expose its loopback listener in request.url.
 * The configured deployment supplies the scheme and allowed host boundary;
 * proxy headers may select only that root or one of its workspace subdomains.
 * Local development keeps its own origin. Untrusted hosts fall back to root.
 */
export function requestPublicOrigin(request: Request): string {
  const root = deploymentOrigin();
  const incoming = new URL(request.url);
  const host = request.headers.get("host");
  const forwardedHost = request.headers.get("x-forwarded-host");

  for (const value of [host, forwardedHost]) {
    if (!value) continue;
    const candidate = hostUrl(value, root.protocol);
    if (!candidate) return root.origin;
    if (allowedHost(candidate, root)) return candidate.origin;
    if (!isLoopbackHost(candidate.host)) return root.origin;
  }

  if (allowedHost(incoming, root)) {
    return `${root.protocol}//${incoming.host}`;
  }
  if (process.env.NODE_ENV !== "production" && isLoopbackHost(incoming.host)) {
    return incoming.origin;
  }
  return root.origin;
}
