import { recordAction } from "@/lib/audit";
import { fetchPublicResource } from "@/lib/bookmark-fetch";
import { listNotificationChannels, recordNotificationDelivery, type NotificationChannelRecord } from "@/lib/store";
import { buildNotificationRequest, type NotificationMessage } from "./urls";

/**
 * Fan-out to every enabled channel that wants this event. Outbound only:
 * the workspace speaks, nothing calls in. Each delivery is one bounded
 * request through the same public-host gate feeds use (no private
 * addresses, pinned DNS), and a failure on one channel never stops the
 * others or the caller.
 */

export type Delivery = { channelId: string; label: string; ok: boolean; detail: string | null };

export type NotificationFetch = (url: string, init: RequestInit) => Promise<Response | null>;

const TIMEOUT_MS = 10_000;

const defaultFetch: NotificationFetch = (url, init) => fetchPublicResource(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

function wants(channel: NotificationChannelRecord, event: string): boolean {
  if (!channel.enabled) return false;
  if (channel.events.length === 0) return true;
  return channel.events.some((wanted) => wanted === event || (wanted.endsWith(".*") && event.startsWith(wanted.slice(0, -1))));
}

export async function deliverToChannel(channel: NotificationChannelRecord, message: NotificationMessage, fetcher: NotificationFetch = defaultFetch): Promise<Delivery> {
  try {
    const request = buildNotificationRequest(channel.url, message);
    const response = await fetcher(request.url, request.init);
    if (!response) throw new Error("The address is not reachable from here (private hosts are refused)");
    if (!response.ok) throw new Error(`The service answered ${response.status}`);
    await recordNotificationDelivery(channel.id, "ok", null);
    return { channelId: channel.id, label: channel.label, ok: true, detail: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Delivery failed";
    await recordNotificationDelivery(channel.id, "failed", detail);
    return { channelId: channel.id, label: channel.label, ok: false, detail };
  }
}

export async function dispatchNotification(input: { blogId: string; message: NotificationMessage; fetcher?: NotificationFetch }): Promise<Delivery[]> {
  const channels = (await listNotificationChannels(input.blogId)).filter((channel) => wants(channel, input.message.event));
  if (channels.length === 0) return [];
  const deliveries = await Promise.all(channels.map((channel) => deliverToChannel(channel, input.message, input.fetcher)));
  await recordAction({
    actorUserId: null,
    actorType: "human",
    actionName: "notifications.dispatch",
    targetType: "workspace",
    targetId: input.blogId,
    inputSummary: input.message.event,
    outputSummary: `${deliveries.filter((delivery) => delivery.ok).length} of ${deliveries.length} delivered`,
  });
  return deliveries;
}

export const NOTIFICATION_EVENTS = [
  { id: "reading.digest", label: "Daily reading digest" },
  { id: "reading.alert", label: "Saved-search alerts" },
  { id: "github.backup", label: "Backup outcomes" },
] as const;
