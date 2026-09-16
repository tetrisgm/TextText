"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { refreshWorkspacePool } from "@/lib/pool/store";
import { fetchDigestSetting, fetchFeedConnections, importOpml, manageFeed, opmlExportUrl, readingExportUrl, sendDigestNow, setDigestHour, type FeedConnectionView } from "@/lib/reading/client";
import styles from "./Reading.module.css";

/**
 * Manage sources: every feed at or under a folder, with its health and the
 * three non-destructive verbs (pause, resume, detach), plus OPML in and out.
 * Deleting a feed's folder stays the folder's own flow, with its preview.
 */

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const HEALTH_LABEL: Record<string, string> = {
  healthy: "Healthy",
  checking: "Checking",
  stale: "Stale",
  degraded: "Having trouble",
  rate_limited: "Rate limited",
  failing: "Failing",
  moved: "Moved",
  auth_required: "Needs sign-in",
  unsupported: "Unsupported",
  disabled: "Paused",
};

export function ManageSourcesDialog({
  handle,
  blogId,
  folderPath,
  folderName,
  onClose,
  onChanged,
}: {
  handle: string;
  blogId: string;
  folderPath: string;
  folderName: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const titleId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [connections, setConnections] = useState<FeedConnectionView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<string | null>(null);
  const [detaching, setDetaching] = useState<FeedConnectionView | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [digest, setDigest] = useState<{ hour: number | null; sentOn: string | null } | null>(null);
  const [digestNotice, setDigestNotice] = useState<string | null>(null);
  useEffect(() => {
    if (folderPath !== "") return;
    let cancelled = false;
    void fetchDigestSetting(handle)
      .then((setting) => {
        if (!cancelled) setDigest(setting);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [folderPath, handle]);
  const [draft, setDraft] = useState<{ name: string; retention: string; muted: string }>({ name: "", retention: "", muted: "" });

  const beginEdit = (connection: FeedConnectionView) => {
    setEditing(connection.id);
    setDraft({
      name: connection.folderName,
      retention: connection.retentionDays === null ? "" : String(connection.retentionDays),
      muted: connection.mutedKeywords.join(", "),
    });
  };
  const saveEdit = async (connection: FeedConnectionView) => {
    setBusy(connection.id);
    setError(null);
    try {
      await manageFeed({
        handle,
        id: connection.id,
        action: "settings",
        settings: {
          name: draft.name.trim() && draft.name.trim() !== connection.folderName ? draft.name.trim() : undefined,
          retentionDays: draft.retention.trim() === "" ? null : Number(draft.retention),
          mutedKeywords: draft.muted.split(/[,\n]/).map((word) => word.trim()).filter(Boolean),
        },
      });
      setEditing(null);
      await refreshWorkspacePool(handle, blogId).catch(() => undefined);
      await load();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save settings");
    } finally {
      setBusy(null);
    }
  };

  const load = useCallback(async () => {
    try {
      const result = await fetchFeedConnections(handle);
      setConnections(
        result.connections.filter(
          (connection) =>
            connection.state !== "detached" &&
            (folderPath === "" || connection.folderPath === folderPath || connection.folderPath.startsWith(`${folderPath}/`)),
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load sources");
    }
  }, [folderPath, handle]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (detaching) setDetaching(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detaching, onClose]);

  const act = useCallback(
    async (connection: FeedConnectionView, action: "pause" | "resume" | "refresh" | "detach" | "adopt_move", keepAllItems = false) => {
      setBusy(connection.id);
      setError(null);
      try {
        await manageFeed({ handle, id: connection.id, action, keepAllItems });
        await load();
        if (action === "detach") await refreshWorkspacePool(handle, blogId).catch(() => undefined);
        onChanged();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "That did not work");
      } finally {
        setBusy(null);
      }
    },
    [blogId, handle, load, onChanged],
  );

  const onImportFile = useCallback(
    async (file: File) => {
      setBusy("import");
      setError(null);
      setImportReport(null);
      try {
        const text = await file.text();
        const report = await importOpml({ handle, parentFolderPath: folderPath, opml: text });
        const added = report.results.filter((entry) => entry.status === "added").length;
        const existing = report.results.filter((entry) => entry.status === "existing").length;
        const failed = report.results.filter((entry) => entry.status === "failed");
        setImportReport(
          [
            `${added} added`,
            existing ? `${existing} already followed` : null,
            failed.length ? `${failed.length} could not be added: ${failed.map((entry) => entry.title ?? entry.url).join(", ")}` : null,
            report.skipped ? `${report.skipped} skipped past the limit of one import` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        );
        await refreshWorkspacePool(handle, blogId).catch(() => undefined);
        await load();
        onChanged();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not import that file");
      } finally {
        setBusy(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [blogId, folderPath, handle, load, onChanged],
  );

  return (
    <div
      className={`applecms ${styles.backdrop}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
        <header className={styles.panelHeader}>
          <div>
            <h2 id={titleId}>{folderPath === "" ? "All sources" : `Sources in ${folderName}`}</h2>
            <p>Pause a feed to stop checking it. Detach to keep the folder as an ordinary folder.</p>
          </div>
          <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className={styles.panelBody}>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {importReport && <p className={styles.note} role="status">{importReport}</p>}
          {connections === null ? (
            <p className={styles.note}>Loading…</p>
          ) : connections.length === 0 ? (
            <p className={styles.note}>No feeds here yet.</p>
          ) : (
            <ul className={styles.candidates} aria-label="Sources">
              {connections.map((connection) => (
                <li key={connection.id} className={styles.sourceRow}>
                  <div>
                    <strong>{connection.publisherTitle ?? connection.folderName}</strong>
                    <small>
                      {connection.folderPath} · {connection.endpoint}
                    </small>
                    <small className={styles.health}>
                      <span className={styles.healthDot} data-health={connection.state === "paused" ? "disabled" : connection.health} aria-hidden="true" />
                      {connection.state === "paused" ? "Paused" : (HEALTH_LABEL[connection.health] ?? connection.health)}
                      {connection.healthDetail ? ` · ${connection.healthDetail}` : ""} · last delivered {relativeTime(connection.lastSuccessAt)}
                      {" · "}
                      {connection.effectiveRetentionDays === 0 ? "kept until deleted" : `kept ${connection.effectiveRetentionDays} days`}
                    </small>
                  </div>
                  <div className={styles.controls}>
                    <button type="button" className={styles.button} disabled={busy === connection.id || connection.state === "paused"} onClick={() => void act(connection, "refresh")}>
                      Check now
                    </button>
                    {connection.state === "paused" ? (
                      <button type="button" className={styles.button} disabled={busy === connection.id} onClick={() => void act(connection, "resume")}>
                        Resume
                      </button>
                    ) : (
                      <button type="button" className={styles.button} disabled={busy === connection.id} onClick={() => void act(connection, "pause")}>
                        Pause
                      </button>
                    )}
                    <button type="button" className={styles.button} disabled={busy === connection.id} onClick={() => setDetaching(connection)}>
                      Detach
                    </button>
                    <button type="button" className={styles.button} aria-expanded={editing === connection.id} onClick={() => (editing === connection.id ? setEditing(null) : beginEdit(connection))}>
                      Settings
                    </button>
                  </div>
                  {connection.movedToUrl && (
                    <div className={styles.confirm} role="status">
                      <p>
                        The publisher now serves this feed at <strong>{connection.movedToUrl}</strong>. Checks still follow the old address for now.
                      </p>
                      <div className={styles.controls}>
                        <button type="button" className={styles.primary} disabled={busy === connection.id} onClick={() => void act(connection, "adopt_move")}>
                          Use the new address
                        </button>
                      </div>
                    </div>
                  )}
                  {editing === connection.id && (
                    <div className={styles.settings}>
                      <label className={styles.field}>
                        Folder name
                        <input value={draft.name} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                      </label>
                      <label className={styles.field}>
                        Keep articles for (days; blank = workspace default, 0 = until deleted)
                        <input type="number" min={0} max={3650} value={draft.retention} onChange={(event) => setDraft((current) => ({ ...current, retention: event.target.value }))} />
                      </label>
                      <label className={styles.field}>
                        Mute articles containing (comma separated)
                        <input value={draft.muted} placeholder="sponsored, giveaway" onChange={(event) => setDraft((current) => ({ ...current, muted: event.target.value }))} />
                      </label>
                      <div className={styles.controls}>
                        <button type="button" className={styles.button} onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                        <button type="button" className={styles.primary} disabled={busy === connection.id} onClick={() => void saveEdit(connection)}>
                          Save settings
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {detaching && (
            <div className={styles.confirm} role="alertdialog" aria-label="Detach source">
              <p>
                Detach <strong>{detaching.publisherTitle ?? detaching.folderName}</strong>? The folder and its articles stay; nothing new arrives. Keep every
                article it has delivered, or let the ones nobody kept expire on schedule?
              </p>
              <div className={styles.controls}>
                <button type="button" className={styles.button} onClick={() => setDetaching(null)}>
                  Cancel
                </button>
                <span className={styles.spacer} />
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => {
                    const target = detaching;
                    setDetaching(null);
                    void act(target, "detach", false);
                  }}
                >
                  Detach, expire on schedule
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => {
                    const target = detaching;
                    setDetaching(null);
                    void act(target, "detach", true);
                  }}
                >
                  Detach and keep everything
                </button>
              </div>
            </div>
          )}
        </div>
        {folderPath === "" && (
          <div className={styles.panelBody} style={{ paddingTop: 0 }}>
            <div className={styles.settings}>
              <label className={styles.field}>
                Daily digest email (UTC hour)
                <select
                  value={digest?.hour === null || digest === null ? "" : String(digest.hour)}
                  onChange={(event) => {
                    const value = event.target.value === "" ? null : Number(event.target.value);
                    void setDigestHour(handle, value)
                      .then(setDigest)
                      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not save the digest hour"));
                  }}
                >
                  <option value="">Off</option>
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {String(hour).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.field}>
                Alerts and what arrived in the last day, sent to the owner&apos;s email.
                <div className={styles.controls}>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={busy === "digest"}
                    onClick={() => {
                      setBusy("digest");
                      setDigestNotice(null);
                      void sendDigestNow(handle)
                        .then((report) =>
                          setDigestNotice(
                            report.sent
                              ? `Sent ${report.articles} articles and ${report.alerts} alerts to ${report.to}.`
                              : report.reason === "nothing_new"
                                ? "Nothing new in the last day."
                                : report.reason === "mailer_unavailable"
                                  ? "Email is not configured on this deployment."
                                  : "The owner account has no email address.",
                          ),
                        )
                        .catch((caught: unknown) => setDigestNotice(caught instanceof Error ? caught.message : "Could not send"))
                        .finally(() => setBusy(null));
                    }}
                  >
                    {busy === "digest" ? "Sending…" : "Send a digest now"}
                  </button>
                  {digestNotice && <span className={styles.note}>{digestNotice}</span>}
                </div>
              </div>
            </div>
          </div>
        )}
        <footer className={styles.panelFooter}>
          <input
            ref={fileRef}
            type="file"
            accept=".opml,.xml,text/xml,text/x-opml"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onImportFile(file);
            }}
          />
          <button type="button" className={styles.button} disabled={busy === "import"} onClick={() => fileRef.current?.click()}>
            {busy === "import" ? "Importing…" : "Import OPML"}
          </button>
          <a className={styles.button} href={opmlExportUrl(handle)} download>
            Export OPML
          </a>
          <a className={styles.button} href={readingExportUrl(handle, folderPath, "all", "json")} download title="Every article in scope, as JSON">
            Export articles
          </a>
          <a className={styles.button} href={readingExportUrl(handle, folderPath, "kept", "csv")} download title="Starred, kept, and commented articles, as CSV">
            Export kept (CSV)
          </a>
          <span className={styles.spacer} />
          <button type="button" className={styles.primary} onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
