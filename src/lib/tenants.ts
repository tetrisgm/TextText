// Host-based tenant resolution for the multi-tenant platform.
//
// Model: every blog lives at {handle}.{ROOT_DOMAIN} (custom domains later map
// onto the same handles via a lookup table). The proxy rewrites tenant hosts
// to /t/{handle}/... so the app routes stay plain.
//
// Local dev: modern browsers resolve {handle}.localhost without /etc/hosts,
// so tenant subdomains can exercise the full tenant path.

import { RESERVED_HANDLES } from "./reserved-names";

export { RESERVED_HANDLES };

/** Platform root, no scheme, may include a port. */
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "TextText.app";

/** The seeded demo blog: reserved from claiming, but it must still resolve. */
const DEMO_HANDLE = "demo";

export const TENANT_HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

function stripPort(host: string): string {
  return host.split(":")[0];
}

/**
 * The tenant handle for an incoming Host header, or null when the request is
 * for the platform site itself (root, www, reserved, or an unrelated host).
 */
export function tenantFromHost(host: string | null): string | null {
  if (!host) return null;
  const bare = stripPort(host.toLowerCase());
  const rootBare = stripPort(ROOT_DOMAIN.toLowerCase());
  if (bare === rootBare || bare === `www.${rootBare}`) return null;
  if (!bare.endsWith(`.${rootBare}`)) return null; // custom domains: later, via lookup
  const sub = bare.slice(0, -(rootBare.length + 1));
  if (!sub || sub.includes(".")) return null; // one level only
  if (sub !== DEMO_HANDLE && RESERVED_HANDLES.has(sub)) return null;
  if (!TENANT_HANDLE_RE.test(sub)) return null;
  return sub;
}
