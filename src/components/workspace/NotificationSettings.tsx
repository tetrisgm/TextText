"use client";

import { useEffect, useState } from "react";
import type { NotificationChannelView } from "@/app/api/workspace/notifications/route";
import styles from "./WorkspaceSettings.module.css";

/**
 * Outbound notifications: where this workspace speaks when nothing is
 * calling in. Apprise-style URLs for the services people already use, or a
 * plain webhook that receives JSON. The URL is sent once and shown masked
 * from then on.
 */

type EventOption = { id: string; label: string };

const HINT = "ntfy://topic, discord://id/token, slack://A/B/C, tgram://bot_token/chat_id, pover://user@token, jsons://host/path, apprise://host/key, or https://your-webhook";

export function NotificationSettings({ handle }: { handle: string }) {
  const [channels, setChannels] = useState<NotificationChannelView[] | null>(null);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/workspace/notifications?handle=${encodeURIComponent(handle)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as { channels: NotificationChannelView[]; events: EventOption[] }) : null))
      .then((data) => {
        if (cancelled || !data) return;
        setChannels(data.channels);
        setEvents(data.events);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [handle]);

  if (channels === null) return null;

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/workspace/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, ...body }) });
    const data = (await response.json()) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Something went wrong");
    return data;
  };

  const add = async () => {
    setBusy("add");
    setNotice(null);
    try {
      const data = await post({ action: "add", url, label });
      setChannels((current) => [...(current ?? []), data.channel as NotificationChannelView]);
      setUrl("");
      setLabel("");
      setNotice("Added. Send a test to check it.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add the channel");
    } finally {
      setBusy(null);
    }
  };

  const update = async (channel: NotificationChannelView, patch: { enabled?: boolean; events?: string[] }) => {
    setBusy(channel.id);
    try {
      const data = await post({ action: "update", id: channel.id, ...patch });
      setChannels((current) => (current ?? []).map((entry) => (entry.id === channel.id ? (data.channel as NotificationChannelView) : entry)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update the channel");
    } finally {
      setBusy(null);
    }
  };

  const test = async (channel: NotificationChannelView) => {
    setBusy(channel.id);
    setNotice(null);
    try {
      const data = await post({ action: "test", id: channel.id });
      const delivery = data.delivery as { ok: boolean; detail: string | null };
      setNotice(delivery.ok ? `Test delivered to ${channel.label}.` : `${channel.label}: ${delivery.detail ?? "delivery failed"}`);
      setChannels((current) => (current ?? []).map((entry) => (entry.id === channel.id ? { ...entry, lastStatus: delivery.ok ? "ok" : "failed", lastDetail: delivery.detail, lastUsedAt: new Date().toISOString() } : entry)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send the test");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (channel: NotificationChannelView) => {
    setBusy(channel.id);
    try {
      await post({ action: "remove", id: channel.id });
      setChannels((current) => (current ?? []).filter((entry) => entry.id !== channel.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove the channel");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.section} id="settings-notifications" aria-labelledby="settings-notifications-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="settings-notifications-title">Notifications</h2>
          <p>Where this workspace speaks: the daily reading digest, saved-search alerts, and backup outcomes go to these channels alongside email. Paste an Apprise-style URL or a webhook.</p>
        </div>
      </div>
      {notice && (
        <p className={styles.aiNotConfigured} role="status">
          {notice}
        </p>
      )}
      {channels.length > 0 && (
        <ul className={styles.connectionList}>
          {channels.map((channel) => (
            <li className={styles.connectionRow} key={channel.id}>
              <div className={styles.connectionMain}>
                <span className={styles.connectionName}>
                  {channel.label} <small>({channel.service})</small>
                </span>
                <span className={styles.connectionMeta}>
                  <code>{channel.masked}</code>
                  {channel.lastUsedAt ? ` · Last ${channel.lastStatus === "ok" ? "delivered" : "failed"} ${new Date(channel.lastUsedAt).toLocaleString()}${channel.lastStatus !== "ok" && channel.lastDetail ? `: ${channel.lastDetail}` : ""}` : " · Never used"}
                </span>
                <span className={styles.connectionMeta}>
                  {events.map((event) => {
                    const all = channel.events.length === 0;
                    const on = all || channel.events.includes(event.id);
                    return (
                      <label key={event.id} style={{ marginRight: 12 }}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={busy === channel.id}
                          onChange={(changed) => {
                            const current = all ? events.map((entry) => entry.id) : channel.events;
                            const next = changed.target.checked ? [...new Set([...current, event.id])] : current.filter((entry) => entry !== event.id);
                            void update(channel, { events: next.length === events.length ? [] : next });
                          }}
                        />{" "}
                        {event.label}
                      </label>
                    );
                  })}
                </span>
              </div>
              <div className={styles.connectionActions}>
                <button type="button" className="ac-btn ac-btn-plain" onClick={() => void update(channel, { enabled: !channel.enabled })} disabled={busy === channel.id}>
                  {channel.enabled ? "Pause" : "Resume"}
                </button>
                <button type="button" className="ac-btn ac-btn-plain" onClick={() => void test(channel)} disabled={busy === channel.id}>
                  Send a test
                </button>
                <button type="button" className="ac-btn ac-btn-plain ac-danger" onClick={() => void remove(channel)} disabled={busy === channel.id}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className={styles.aiForm}
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label>
          Notification URL
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={HINT} autoComplete="off" spellCheck={false} required />
        </label>
        <label>
          Label (optional)
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Phone, team channel, ..." />
        </label>
        <div className={styles.connectionActions}>
          <button type="submit" className="ac-btn ac-btn-filled" disabled={busy === "add" || !url.trim()}>
            {busy === "add" ? "Adding" : "Add channel"}
          </button>
        </div>
      </form>
    </section>
  );
}
