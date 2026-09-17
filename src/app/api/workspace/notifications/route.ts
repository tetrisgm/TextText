import { getCurrentUser } from "@/lib/session";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { deliverToChannel, NOTIFICATION_EVENTS } from "@/lib/notifications/dispatch.server";
import { parseNotificationUrl } from "@/lib/notifications/urls";
import { addNotificationChannel, getBlog, listNotificationChannels, removeNotificationChannel, updateNotificationChannel, type NotificationChannelRecord } from "@/lib/store";

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: PRIVATE });
const jsonError = (message: string, status: number) => Response.json({ error: message }, { status, headers: PRIVATE });

export type NotificationChannelView = {
  id: string;
  kind: "apprise" | "webhook";
  service: string;
  label: string;
  masked: string;
  enabled: boolean;
  events: string[];
  lastUsedAt: string | null;
  lastStatus: string | null;
  lastDetail: string | null;
};

function view(channel: NotificationChannelRecord): NotificationChannelView {
  const parsed = parseNotificationUrl(channel.url);
  return {
    id: channel.id,
    kind: channel.kind,
    service: parsed.ok ? parsed.target.service : "Unknown",
    label: channel.label,
    masked: parsed.ok ? parsed.target.masked : "(unreadable)",
    enabled: channel.enabled,
    events: channel.events,
    lastUsedAt: channel.lastUsedAt ? channel.lastUsedAt.toISOString() : null,
    lastStatus: channel.lastStatus,
    lastDetail: channel.lastDetail,
  };
}

async function owner(handle: string) {
  const user = await getCurrentUser();
  if (!user) return { response: jsonError("Sign in first", 401) };
  const access = await getBlogEditAccess(handle);
  if (!access.canEdit || !access.isOwner || !access.ownerId || !access.blogId) return { response: jsonError("Only the workspace owner can manage notifications", 403) };
  return { userId: access.ownerId, blogId: access.blogId };
}

/** GET ?handle= -> channels (masked) and the events they can subscribe to. */
export async function GET(request: Request) {
  const handle = new URL(request.url).searchParams.get("handle")?.trim() ?? "";
  if (!handle) return jsonError("Missing workspace handle", 400);
  const who = await owner(handle);
  if ("response" in who) return who.response;
  return json({ channels: (await listNotificationChannels(who.blogId)).map(view), events: NOTIFICATION_EVENTS });
}

/**
 * POST { handle, action }:
 *   "add" { url, label?, events? }      add a channel; the URL is validated and never echoed back
 *   "update" { id, enabled?, events? }
 *   "remove" { id }
 *   "test" { id }                        deliver a test message now
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const handle = typeof body.handle === "string" ? body.handle.trim() : "";
  if (!handle) return jsonError("Missing workspace handle", 400);
  const who = await owner(handle);
  if ("response" in who) return who.response;
  const actor = { userId: who.userId, actorType: "human" as const };
  const events = Array.isArray(body.events) ? body.events.filter((value): value is string => typeof value === "string" && NOTIFICATION_EVENTS.some((event) => event.id === value)) : undefined;
  const id = typeof body.id === "string" ? body.id : "";
  try {
    switch (body.action) {
      case "add": {
        const url = typeof body.url === "string" ? body.url.trim() : "";
        const parsed = parseNotificationUrl(url);
        if (!parsed.ok) return jsonError(parsed.reason, 400);
        const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : parsed.target.label;
        const channel = await addNotificationChannel({ blogId: who.blogId, kind: parsed.target.kind, url, label, events, actor });
        return json({ channel: view(channel) }, 201);
      }
      case "update": {
        const channel = await updateNotificationChannel({ blogId: who.blogId, channelId: id, enabled: typeof body.enabled === "boolean" ? body.enabled : undefined, events, actor });
        return channel ? json({ channel: view(channel) }) : jsonError("No such channel", 404);
      }
      case "remove":
        return json({ removed: await removeNotificationChannel({ blogId: who.blogId, channelId: id, actor }) });
      case "test": {
        const channel = (await listNotificationChannels(who.blogId)).find((entry) => entry.id === id);
        if (!channel) return jsonError("No such channel", 404);
        const blog = await getBlog(handle);
        const delivery = await deliverToChannel(channel, {
          event: "test",
          title: `TextText test from ${blog?.name ?? handle}`,
          body: "If you can read this, the channel works. Digests, alerts, and backup outcomes will arrive the same way.",
          url: null,
          workspace: { handle, name: blog?.name ?? handle },
        });
        return json({ delivery });
      }
      default:
        return jsonError("Unknown action", 400);
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Something went wrong", 400);
  }
}
