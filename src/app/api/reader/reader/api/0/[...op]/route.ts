import {
  editSubscription,
  editTag,
  markAllAsRead,
  readerIdentity,
  streamContents,
  streamItemIds,
  subscriptionList,
  tagList,
  unreadCount,
} from "@/lib/reading/reader-api.server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function readParams(request: Request): Promise<URLSearchParams> {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.searchParams);
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("form")) {
      const form = await request.formData();
      for (const [key, value] of form.entries()) if (typeof value === "string") params.append(key, value);
    } else if (contentType.includes("json")) {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      for (const [key, value] of Object.entries(body)) {
        for (const entry of Array.isArray(value) ? value : [value]) params.append(key, String(entry));
      }
    }
  }
  return params;
}

async function handle(request: Request, context: { params: Promise<{ op: string[] }> }) {
  const { op } = await context.params;
  const path = op.join("/");
  const params = await readParams(request);
  const identity = await readerIdentity(request, params.get("Auth"));
  if (!identity) return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": "GoogleLogin" } });
  const origin = new URL(request.url).origin;
  switch (path) {
    case "token":
      // A CSRF token for the client to echo back; any value works here.
      return new Response(identity.token.slice(0, 24), { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
    case "user-info":
      return json({ userId: identity.user.userId, userName: identity.handle, userEmail: "", userProfileId: identity.user.userId, isBloggerUser: false, signupTimeSec: 0 });
    case "subscription/list":
      return json(await subscriptionList(identity));
    case "tag/list":
      return json(await tagList(identity));
    case "unread-count":
      return json(await unreadCount(identity));
    case "stream/items/ids":
      return json(await streamItemIds(identity, params));
    case "stream/items/contents":
      return json(await streamContents(identity, params, params.getAll("i"), origin));
    case "edit-tag": {
      await editTag(identity, params.getAll("i"), params.getAll("a"), params.getAll("r"));
      return new Response("OK", { headers: { "content-type": "text/plain" } });
    }
    case "mark-all-as-read": {
      await markAllAsRead(identity, params.get("s"));
      return new Response("OK", { headers: { "content-type": "text/plain" } });
    }
    case "subscription/edit":
    case "subscription/quickadd": {
      const result = await editSubscription(identity, params);
      if (!result.ok) return json({ error: result.error }, 400);
      return path === "subscription/quickadd" ? json({ query: params.get("quickadd") ?? "", numResults: 1, streamId: result.streamId ?? "" }) : new Response("OK", { headers: { "content-type": "text/plain" } });
    }
    default:
      if (path.startsWith("stream/contents/")) {
        params.set("s", decodeURIComponent(path.slice("stream/contents/".length)));
        return json(await streamContents(identity, params, null, origin));
      }
      return new Response("Not found", { status: 404 });
  }
}

export { handle as GET, handle as POST };
