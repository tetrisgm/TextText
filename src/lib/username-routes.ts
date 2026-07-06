import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AT_ALIAS_HEADER } from "@/lib/at-alias";
import { getBlogByUsername } from "@/lib/store";

export { AT_ALIAS_HEADER };

type TenantRouteHandler<TenantParams extends { handle: string }> = (
  request: Request,
  context: { params: Promise<TenantParams> },
) => Response | Promise<Response>;

// Wraps a tenant /t/[handle] route handler as a /u/[username] one: resolves
// the username to its blog, answers 404 when there is none, then delegates
// to the tenant GET with a synthesized handle params promise. Extra segment
// params (like slug) pass through untouched.
export function withUsernameBlog<TenantParams extends { handle: string }>(
  handler: TenantRouteHandler<TenantParams>,
) {
  return async function GET(
    request: Request,
    {
      params,
    }: {
      params: Promise<Omit<TenantParams, "handle"> & { username: string }>;
    },
  ): Promise<Response> {
    const { username, ...rest } = await params;
    const blog = await getBlogByUsername(username).catch(() => null);
    if (!blog) return new Response("Not found", { status: 404 });
    // The cast rebuilds TenantParams from its own pieces; TS cannot prove
    // the round trip through Omit, hence the unknown hop.
    return handler(request, {
      params: Promise.resolve({
        ...rest,
        handle: blog.handle,
      } as unknown as TenantParams),
    });
  };
}

type SearchParamsRecord = Record<string, string | string[] | undefined>;

// Serialize a page's resolved searchParams back into a query string
// (empty string when there is nothing to carry over).
export function searchParamsToQuery(
  searchParams: SearchParamsRecord | undefined,
): string {
  if (!searchParams) return "";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) query.append(key, item);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

// The /u/{username} tree exists only as the proxy's rewrite target for the
// canonical /@{username} URLs. A request that reaches a /u page without the
// proxy's alias marker was typed directly, so send it to the canonical /@
// URL, keeping the query string.
export async function redirectDirectUsernameHit(
  canonicalPath: string,
  searchParams: SearchParamsRecord | undefined,
): Promise<void> {
  const requestHeaders = await headers();
  if (requestHeaders.has(AT_ALIAS_HEADER)) return;
  redirect(`${canonicalPath}${searchParamsToQuery(searchParams)}`);
}
