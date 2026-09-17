/**
 * Apprise-style notification URLs, resolved into one HTTP request each.
 *
 * The scheme names the service and the path carries what it needs, the way
 * Apprise spells them, so a URL copied from Apprise's own documentation
 * works here. A handful of services are spoken to directly; anything else
 * goes through a self-hosted Apprise API (`apprise://host/key`) or a plain
 * webhook (`https://...`, `json://host/path`) that receives the message as
 * JSON. No credential is ever logged: labels and lists show the masked form.
 */

export type NotificationMessage = {
  /** "reading.digest" | "reading.alert" | "test" | ... */
  event: string;
  title: string;
  body: string;
  /** Where to go for more, when there is somewhere. */
  url?: string | null;
  workspace: { handle: string; name: string };
  items?: Array<{ title: string; url: string | null; source?: string | null }>;
};

export type NotificationTarget = { kind: "apprise" | "webhook"; service: string; label: string; masked: string };

export type NotificationRequest = { url: string; init: { method: "POST"; headers: Record<string, string>; body: string } };

const SERVICES: Record<string, string> = {
  ntfy: "ntfy",
  ntfys: "ntfy",
  discord: "Discord",
  slack: "Slack",
  tgram: "Telegram",
  pover: "Pushover",
  json: "JSON endpoint",
  jsons: "JSON endpoint",
  apprise: "Apprise API",
  apprises: "Apprise API",
  https: "Webhook",
};

function parts(url: URL): { user: string; pass: string; host: string; segments: string[] } {
  return {
    user: decodeURIComponent(url.username),
    pass: decodeURIComponent(url.password),
    host: url.hostname,
    segments: url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment)),
  };
}

function mask(value: string): string {
  if (value.length <= 6) return "•••";
  return `${value.slice(0, 3)}…${value.slice(-2)}`;
}

/** What this URL is and how to show it, or a reason it is refused. */
const TGRAM = /^tgram:\/\/([^/@]+)\/([^/?#]+)\/?$/i;

export function parseNotificationUrl(raw: string): { ok: true; target: NotificationTarget } | { ok: false; reason: string } {
  const telegram = raw.trim().match(TGRAM);
  if (telegram) {
    return { ok: true, target: { kind: "apprise", service: "Telegram", label: `Telegram chat ${telegram[2]}`, masked: `tgram://${mask(telegram[1])}/${telegram[2]}` } };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "That is not a URL" };
  }
  const scheme = url.protocol.replace(":", "").toLowerCase();
  const service = SERVICES[scheme];
  if (!service) return { ok: false, reason: `Unsupported scheme "${scheme}". Use ntfy, discord, slack, tgram, pover, json, apprise, or https.` };
  if (scheme === "http") return { ok: false, reason: "Webhooks must use https" };
  if (scheme === "https" && (url.username || url.password)) return { ok: false, reason: "Put credentials in the webhook path or use jsons://user:pass@host/path for Basic auth" };
  const { user, pass, host, segments } = parts(url);
  const kind: NotificationTarget["kind"] = scheme === "https" ? "webhook" : "apprise";
  switch (scheme) {
    case "ntfy":
    case "ntfys": {
      // ntfy://topic (ntfy.sh) or ntfys://host/topic
      const topic = segments.length ? segments[segments.length - 1] : host;
      if (!topic) return { ok: false, reason: "ntfy needs a topic" };
      const where = segments.length ? host : "ntfy.sh";
      return { ok: true, target: { kind, service, label: `ntfy ${topic} on ${where}`, masked: `${scheme}://${segments.length ? `${where}/` : ""}${topic}` } };
    }
    case "discord":
      if (segments.length < 1 || !host) return { ok: false, reason: "Discord needs discord://webhook_id/webhook_token" };
      return { ok: true, target: { kind, service, label: "Discord webhook", masked: `discord://${host}/${mask(segments[0])}` } };
    case "slack":
      if (segments.length < 2 || !host) return { ok: false, reason: "Slack needs slack://TokenA/TokenB/TokenC" };
      return { ok: true, target: { kind, service, label: "Slack webhook", masked: `slack://${host}/${mask(segments[0])}/${mask(segments[1])}` } };
    case "tgram":
      return { ok: false, reason: "Telegram needs tgram://bot_token/chat_id" };
    case "pover":
      if (!user || !host) return { ok: false, reason: "Pushover needs pover://user@token" };
      return { ok: true, target: { kind, service, label: "Pushover", masked: `pover://${mask(user)}@${mask(host)}` } };
    case "json":
    case "jsons":
      if (!host) return { ok: false, reason: "A JSON endpoint needs a host" };
      return { ok: true, target: { kind, service, label: `JSON to ${host}`, masked: `${scheme}://${pass ? `${user}:•••@` : ""}${host}${url.pathname}` } };
    case "apprise":
    case "apprises":
      if (!host || segments.length < 1) return { ok: false, reason: "An Apprise API needs apprise://host/config_key" };
      return { ok: true, target: { kind, service, label: `Apprise API on ${host}`, masked: `${scheme}://${host}/${mask(segments[0])}` } };
    default:
      return { ok: true, target: { kind, service, label: `Webhook to ${host}`, masked: `https://${host}${url.pathname.length > 24 ? `${url.pathname.slice(0, 20)}…` : url.pathname}` } };
  }
}

function plainText(message: NotificationMessage): string {
  const lines = [message.body.trim()];
  if (message.url) lines.push("", message.url);
  return lines.join("\n");
}

function jsonPayload(message: NotificationMessage): Record<string, unknown> {
  return {
    schema: "texttext.notification.v1",
    event: message.event,
    title: message.title,
    body: message.body,
    url: message.url ?? null,
    workspace: message.workspace,
    items: message.items ?? [],
    sentAt: new Date().toISOString(),
  };
}

const JSON_HEADERS = { "Content-Type": "application/json", "User-Agent": "TextText" };

/** The single request that delivers this message to this URL. */
export function buildNotificationRequest(raw: string, message: NotificationMessage): NotificationRequest {
  const telegram = raw.trim().match(TGRAM);
  if (telegram) {
    return {
      url: `https://api.telegram.org/bot${encodeURIComponent(telegram[1])}/sendMessage`,
      init: { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ chat_id: telegram[2], text: `${message.title}\n\n${plainText(message)}`.slice(0, 4000), disable_web_page_preview: true }) },
    };
  }
  const url = new URL(raw.trim());
  const scheme = url.protocol.replace(":", "").toLowerCase();
  const { user, pass, host, segments } = parts(url);
  const json = (target: string, body: unknown, headers: Record<string, string> = {}): NotificationRequest => ({ url: target, init: { method: "POST", headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) } });
  switch (scheme) {
    case "ntfy":
    case "ntfys": {
      const topic = segments.length ? segments[segments.length - 1] : host;
      const base = segments.length ? `https://${host}` : "https://ntfy.sh";
      const headers: Record<string, string> = {};
      if (user && pass) headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
      else if (pass || user) headers.Authorization = `Bearer ${pass || user}`;
      return json(base, { topic, title: message.title, message: plainText(message), ...(message.url ? { click: message.url } : {}) }, headers);
    }
    case "discord":
      return json(`https://discord.com/api/webhooks/${encodeURIComponent(host)}/${encodeURIComponent(segments[0])}`, { username: "TextText", content: `**${message.title}**\n${plainText(message)}`.slice(0, 1900) });
    case "slack":
      return json(`https://hooks.slack.com/services/${[host, ...segments].slice(0, 3).map(encodeURIComponent).join("/")}`, { text: `*${message.title}*\n${plainText(message)}` });
    case "pover":
      return json("https://api.pushover.net/1/messages.json", { token: host, user, title: message.title, message: plainText(message).slice(0, 1024), ...(message.url ? { url: message.url } : {}) });
    case "json":
    case "jsons": {
      const headers: Record<string, string> = {};
      if (user && pass) headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
      // json:// and jsons:// both deliver over https: a credential in the
      // URL must never travel in the clear.
      return json(`https://${host}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}`, jsonPayload(message), headers);
    }
    case "apprise":
    case "apprises":
      return json(`https://${host}${url.port ? `:${url.port}` : ""}/notify/${encodeURIComponent(segments[0])}`, { title: message.title, body: plainText(message), type: "info", format: "text" });
    default:
      return json(url.toString(), jsonPayload(message));
  }
}
