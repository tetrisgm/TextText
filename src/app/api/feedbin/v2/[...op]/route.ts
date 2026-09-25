import {
  entries,
  feed,
  feedbinIdentity,
  renameSubscription,
  setStarred,
  setUnread,
  starredEntryIds,
  subscribe,
  subscriptions,
  taggings,
  tags,
  unreadEntryIds,
  unsubscribe,
} from "@/lib/reading/feedbin-api.server";
import { requestPublicOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === "GET" || request.method === "HEAD") return {};
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("json")) return ((await request.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
  if (contentType.includes("form")) return Object.fromEntries([...(await request.formData()).entries()].map(([key, value]) => [key, String(value)]));
  return {};
}

const numbers = (value: unknown): Array<number | string> => (Array.isArray(value) ? value.filter((entry): entry is number | string => typeof entry === "number" || typeof entry === "string") : []);

async function handle(request: Request, context: { params: Promise<{ op: string[] }> }) {
  const { op } = await context.params;
  const path = op.join("/").replace(/\.json$/, "");
  const url = new URL(request.url);
  const identity = await feedbinIdentity(request);
  if (!identity) return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": 'Basic realm="TextText"' } });
  const body = await readBody(request);
  const method = request.method;
  const feedEntries = path.match(/^feeds\/(\d+)\/entries$/);
  const feedOne = path.match(/^feeds\/(\d+)$/);
  const subscriptionOne = path.match(/^subscriptions\/(\d+)$/);
  const entryOne = path.match(/^entries\/(\d+)$/);

  if (path === "authentication") return new Response(null, { status: 200 });
  if (path === "subscriptions" && method === "GET") return json(await subscriptions(identity));
  if (path === "subscriptions" && method === "POST") {
    const feedUrl = typeof body.feed_url === "string" ? body.feed_url : "";
    if (!feedUrl) return json({ error: "feed_url is required" }, 400);
    const result = await subscribe(identity, feedUrl);
    if (result.status === 404) return json({ error: result.error ?? "Could not subscribe" }, 404);
    return json(result.subscription ?? {}, result.status, result.subscription ? { location: `${requestPublicOrigin(request)}/api/feedbin/v2/subscriptions/${result.subscription.id}.json` } : {});
  }
  if (subscriptionOne && method === "DELETE") return new Response(null, { status: (await unsubscribe(identity, subscriptionOne[1])) ? 204 : 404 });
  if (subscriptionOne && (method === "PATCH" || method === "POST")) {
    const title = typeof body.title === "string" ? body.title : "";
    if (!title) return json({ error: "title is required" }, 400);
    const ok = await renameSubscription(identity, subscriptionOne[1], title);
    if (!ok) return json({ error: "Not found" }, 404);
    const list = await subscriptions(identity);
    return json(list.find((entry) => String(entry.id) === subscriptionOne[1]) ?? {});
  }
  if (subscriptionOne && method === "GET") {
    const list = await subscriptions(identity);
    const one = list.find((entry) => String(entry.id) === subscriptionOne[1]);
    return one ? json(one) : json({ error: "Not found" }, 404);
  }
  if (feedOne && method === "GET") {
    const one = await feed(identity, feedOne[1]);
    return one ? json(one) : json({ error: "Not found" }, 404);
  }
  if (path === "taggings") return json(await taggings(identity));
  if (path === "tags") return json(await tags(identity));
  if (path === "entries" || feedEntries) {
    const result = await entries(identity, url.searchParams, feedEntries?.[1]);
    const headers: Record<string, string> = {};
    if (result.nextPage) {
      const next = new URL(`${url.pathname}${url.search}`, requestPublicOrigin(request));
      next.searchParams.set("page", String(result.nextPage));
      headers.link = `<${next.toString()}>; rel="next"`;
    }
    return json(result.items, 200, headers);
  }
  if (entryOne) {
    const result = await entries(identity, new URLSearchParams({ ids: entryOne[1], mode: url.searchParams.get("mode") ?? "" }));
    return result.items[0] ? json(result.items[0]) : json({ error: "Not found" }, 404);
  }
  if (path === "unread_entries") {
    if (method === "GET") return json(await unreadEntryIds(identity));
    if (method === "POST") return json(await setUnread(identity, numbers(body.unread_entries), true));
    if (method === "DELETE") return json(await setUnread(identity, numbers(body.unread_entries), false));
  }
  if (path === "unread_entries/delete" && method === "POST") return json(await setUnread(identity, numbers(body.unread_entries), false));
  if (path === "starred_entries") {
    if (method === "GET") return json(await starredEntryIds(identity));
    if (method === "POST") return json(await setStarred(identity, numbers(body.starred_entries), true));
    if (method === "DELETE") return json(await setStarred(identity, numbers(body.starred_entries), false));
  }
  if (path === "starred_entries/delete" && method === "POST") return json(await setStarred(identity, numbers(body.starred_entries), false));
  return json({ error: "Not found" }, 404);
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
