import { describe, expect, it } from "vitest";
import { buildNotificationRequest, parseNotificationUrl, type NotificationMessage } from "../urls";

const message: NotificationMessage = { event: "reading.digest", title: "Reading: 3 new articles", body: "HN\n- One\n- Two", url: "https://texttext.app/t/demo", workspace: { handle: "demo", name: "Demo" }, items: [{ title: "One", url: "https://a.example/1", source: "HN" }] };

describe("parseNotificationUrl", () => {
  it("names the service and masks the credential", () => {
    const cases: Array<[string, string, string]> = [
      ["ntfy://my-topic", "ntfy", "ntfy://my-topic"],
      ["ntfys://ntfy.home.example/alerts", "ntfy", "ntfys://ntfy.home.example/alerts"],
      ["discord://1234567890/abcdefghijklmnopqrstuvwxyz", "Discord", "discord://1234567890/abc…yz"],
      ["slack://T000AAA/B000BBB/xxxxyyyyzzzz", "Slack", "slack://T000AAA/B00…BB/xxx…zz"],
      ["tgram://123456:ABC-DEF1234ghIkl/987654321", "Telegram", "tgram://123…kl/987654321"],
      ["pover://uQiRzpo4DXghDmr9QzzfQu27cmVRsG@azGDORePK8gMaC0QOYAMyEEuzJnyUi", "Pushover", "pover://uQi…sG@azG…Ui"],
      ["jsons://user:secret@hooks.example/notify", "JSON endpoint", "jsons://user:•••@hooks.example/notify"],
      ["apprises://apprise.example/abcdefgh", "Apprise API", "apprises://apprise.example/abc…gh"],
      ["https://hooks.example/path/with/a/very/long/segment/here", "Webhook", "https://hooks.example/path/with/a/very/lo…"],
    ];
    for (const [url, service, masked] of cases) {
      const parsed = parseNotificationUrl(url);
      expect(parsed.ok, url).toBe(true);
      if (parsed.ok) {
        expect(parsed.target.service).toBe(service);
        expect(parsed.target.masked).toBe(masked);
        expect(parsed.target.kind).toBe(service === "Webhook" ? "webhook" : "apprise");
      }
    }
  });

  it("refuses what it cannot speak to", () => {
    expect(parseNotificationUrl("not a url").ok).toBe(false);
    expect(parseNotificationUrl("http://plain.example/hook").ok).toBe(false);
    expect(parseNotificationUrl("mailto://a@b").ok).toBe(false);
    expect(parseNotificationUrl("discord://only-id").ok).toBe(false);
    expect(parseNotificationUrl("pover://tokenonly").ok).toBe(false);
    expect(parseNotificationUrl("https://user:pass@hooks.example/x").ok).toBe(false);
  });
});

describe("buildNotificationRequest", () => {
  const body = (url: string) => JSON.parse(buildNotificationRequest(url, message).init.body) as Record<string, unknown>;

  it("speaks each service's own dialect", () => {
    const ntfy = buildNotificationRequest("ntfy://my-topic", message);
    expect(ntfy.url).toBe("https://ntfy.sh");
    expect(body("ntfy://my-topic")).toMatchObject({ topic: "my-topic", title: message.title, click: message.url });
    expect(buildNotificationRequest("ntfys://tok@ntfy.home.example/alerts", message).init.headers.Authorization).toBe("Bearer tok");
    expect(buildNotificationRequest("discord://123/abc", message).url).toBe("https://discord.com/api/webhooks/123/abc");
    expect(body("discord://123/abc").content).toContain("**Reading: 3 new articles**");
    expect(buildNotificationRequest("slack://A/B/C", message).url).toBe("https://hooks.slack.com/services/A/B/C");
    expect(buildNotificationRequest("tgram://bot123:x/42", message).url).toBe("https://api.telegram.org/botbot123%3Ax/sendMessage");
    expect(body("tgram://bot123:x/42")).toMatchObject({ chat_id: "42" });
    expect(body("pover://user@token")).toMatchObject({ token: "token", user: "user", url: message.url });
    expect(buildNotificationRequest("apprises://apprise.example/key", message).url).toBe("https://apprise.example/notify/key");
    // The plain-looking variants still deliver over https: no cleartext credential.
    expect(buildNotificationRequest("apprise://apprise.example/key", message).url).toBe("https://apprise.example/notify/key");
    expect(buildNotificationRequest("json://u:p@hooks.example/notify", message).url).toBe("https://hooks.example/notify");
  });

  it("gives webhooks and json endpoints the full structured payload", () => {
    const hook = buildNotificationRequest("https://hooks.example/x?y=1", message);
    expect(hook.url).toBe("https://hooks.example/x?y=1");
    expect(body("https://hooks.example/x?y=1")).toMatchObject({ schema: "texttext.notification.v1", event: "reading.digest", workspace: { handle: "demo" }, items: message.items });
    const jsons = buildNotificationRequest("jsons://u:p@hooks.example/notify", message);
    expect(jsons.url).toBe("https://hooks.example/notify");
    expect(jsons.init.headers.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });
});
