"use client";

import { useEffect, useState } from "react";
import type { GithubInstallationStatus } from "@/app/api/github/installation/route";
import styles from "./WorkspaceSettings.module.css";

/**
 * The GitHub section of Settings: one installation of the TextText GitHub App
 * per workspace. Connect walks through github.com and back; the connection
 * here is only the installation id and the account it sits on. Item 2 adds
 * the backup target and cadence beneath it.
 */

const OUTCOME_COPY: Record<string, string> = {
  connected: "GitHub is connected.",
  requested: "Your request was sent to the organization's admins. Come back here once they approve it.",
  expired: "The connection attempt expired or did not start here. Try Connect again.",
  "signed-out": "You were signed out during the connection. Sign in and try Connect again.",
  denied: "GitHub did not authorize the connection.",
  "not-yours": "That installation is not one your GitHub account can see, so it was not connected.",
  missing: "GitHub no longer has that installation.",
  failed: "GitHub did not answer as expected. Try Connect again.",
  "not-configured": "GitHub is not set up on this deployment.",
};

function outcomeFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("github");
  return value && OUTCOME_COPY[value] ? value : null;
}

type Repository = { fullName: string; private: boolean; defaultBranch: string };
type BackupSchedule = "off" | "hourly" | "daily" | "weekly";

function BackupControls({ handle, installation, onStatus }: { handle: string; installation: NonNullable<GithubInstallationStatus["installation"]>; onStatus: (message: string) => void }) {
  const [repositories, setRepositories] = useState<Repository[] | null>(null);
  const [repository, setRepository] = useState(installation.backupRepository ?? "");
  const [branch, setBranch] = useState(installation.backupBranch ?? "");
  const [schedule, setSchedule] = useState<BackupSchedule>(installation.backupSchedule);
  const [saved, setSaved] = useState({ repository: installation.backupRepository ?? "", branch: installation.backupBranch ?? "", schedule: installation.backupSchedule });
  const [last, setLast] = useState({ at: installation.backupLastRunAt, status: installation.backupLastStatus, detail: installation.backupLastDetail, commit: installation.backupLastCommit });
  const [busy, setBusy] = useState<"save" | "run" | "restore" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/github/backup?handle=${encodeURIComponent(handle)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as { repositories: Repository[] }).repositories : []))
      .then((list) => {
        if (!cancelled) setRepositories(list);
      })
      .catch(() => {
        if (!cancelled) setRepositories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/github/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, ...body }) });
    const data = (await response.json()) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Something went wrong");
    return data;
  };

  const save = async () => {
    setBusy("save");
    try {
      const data = await post({ action: "settings", repository, branch, schedule });
      setSaved({ repository: (data.repository as string | null) ?? "", branch: (data.branch as string | null) ?? "", schedule: data.schedule as BackupSchedule });
      setSchedule(data.schedule as BackupSchedule);
      onStatus(data.repository ? `Backups go to ${data.repository as string}${data.schedule === "off" ? " when you press Back up now" : ` ${data.schedule as string}`}.` : "Backups are off.");
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Could not save");
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    setBusy("run");
    try {
      const data = await post({ action: "run" });
      const now = new Date().toISOString();
      if (data.ran) {
        const commit = (data.commit as string | null) ?? null;
        setLast({ at: now, status: commit ? "ok" : "unchanged", detail: `${data.documents as number} items, ${data.uploaded as number} uploaded, ${data.removed as number} removed`, commit });
        onStatus(commit ? `Backed up ${data.documents as number} items.` : "Nothing changed since the last backup.");
      } else {
        setLast({ at: now, status: "failed", detail: (data.reason as string) ?? null, commit: null });
        onStatus((data.reason as string) ?? "Backup failed");
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Backup failed");
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!window.confirm("Restore imports every item in the repository that this workspace no longer has. Items that already exist are left alone. Continue?")) return;
    setBusy("restore");
    try {
      const data = await post({ action: "restore" });
      onStatus(`Restored ${data.restored as number} of ${data.considered as number} items; ${data.skipped as number} were already here${(data.failed as number) ? `, ${data.failed as number} failed` : ""}.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Restore failed");
    } finally {
      setBusy(null);
    }
  };

  const dirty = repository !== saved.repository || branch !== saved.branch || schedule !== saved.schedule;
  const options = repositories ?? [];
  const known = options.some((entry) => entry.fullName === repository);

  return (
    <div className={styles.aiForm}>
      <label>
        Repository
        <select value={known || !repository ? repository : "__custom"} onChange={(event) => setRepository(event.target.value === "__custom" ? repository : event.target.value)} disabled={repositories === null}>
          <option value="">{repositories === null ? "Loading repositories" : options.length ? "Choose a repository" : "No repositories the app can push to"}</option>
          {options.map((entry) => (
            <option key={entry.fullName} value={entry.fullName}>
              {entry.fullName}
              {entry.private ? " (private)" : ""}
            </option>
          ))}
          {repository && !known && <option value="__custom">{repository}</option>}
        </select>
      </label>
      <label>
        Branch
        <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder={options.find((entry) => entry.fullName === repository)?.defaultBranch ?? "default branch"} />
      </label>
      <label>
        Schedule
        <select value={schedule} onChange={(event) => setSchedule(event.target.value as BackupSchedule)}>
          <option value="off">Only when I press Back up now</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <p className={styles.aiStatus}>
        {last.at ? (
          <span>
            Last backup {new Date(last.at).toLocaleString()}: <strong>{last.status}</strong>
            {last.detail ? <small> {last.detail}</small> : null}
            {last.commit && saved.repository ? (
              <small>
                {" "}
                <a href={`https://github.com/${saved.repository}/commit/${last.commit}`} target="_blank" rel="noreferrer">
                  {last.commit.slice(0, 7)}
                </a>
              </small>
            ) : null}
          </span>
        ) : (
          <span>No backup yet. Scheduled runs happen while the workspace is open, so a workspace nobody opens waits until someone does.</span>
        )}
      </p>
      <div className={styles.connectionActions}>
        <button type="button" className="ac-btn ac-btn-filled" onClick={() => void save()} disabled={busy !== null || !dirty}>
          {busy === "save" ? "Saving" : "Save"}
        </button>
        <button type="button" className="ac-btn ac-btn-plain" onClick={() => void run()} disabled={busy !== null || !saved.repository || dirty}>
          {busy === "run" ? "Backing up" : "Back up now"}
        </button>
        <button type="button" className="ac-btn ac-btn-plain" onClick={() => void restore()} disabled={busy !== null || !saved.repository || dirty}>
          {busy === "restore" ? "Restoring" : "Restore missing items"}
        </button>
      </div>
    </div>
  );
}

export function GithubSettings({ handle }: { handle: string }) {
  const [status, setStatus] = useState<GithubInstallationStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    const outcome = outcomeFromLocation();
    return outcome ? OUTCOME_COPY[outcome] : null;
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/github/installation?handle=${encodeURIComponent(handle)}&check=1`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as GithubInstallationStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // Offline or not the owner. The section simply does not appear.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  if (!status || !status.configured) return null;
  const installation = status.installation;

  const connect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/github/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle }) });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error ?? "Could not start the connection");
      window.location.assign(data.url);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not start the connection");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/github/installation", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle }) });
      if (!response.ok) throw new Error("Could not disconnect");
      setStatus({ configured: true, installation: null });
      setNotice("Disconnected. The installation stays on GitHub until you remove it there.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not disconnect");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} id="settings-github" aria-labelledby="settings-github-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="settings-github-title">GitHub</h2>
          <p>Install the TextText app on your GitHub account to back this workspace up to a repository you own: every item as a textpack plus a manifest, committed on the schedule you choose. Restore imports what the repository has and the workspace lacks. Sign-in with GitHub is separate and lives under Account.</p>
        </div>
        {!installation && (
          <button type="button" className="ac-btn ac-btn-filled" onClick={() => void connect()} disabled={busy}>
            {busy ? "Opening GitHub" : "Connect GitHub"}
          </button>
        )}
      </div>
      {notice && (
        <p className={styles.aiNotConfigured} role="status">
          {notice}
        </p>
      )}
      {installation && (
        <ul className={styles.connectionList}>
          <li className={styles.connectionRow}>
            <div className={styles.connectionMain}>
              <span className={styles.connectionName}>
                {installation.accountLogin}
                {installation.accountType === "Organization" ? " (organization)" : ""}
              </span>
              <span className={styles.connectionMeta}>
                {installation.repositorySelection === "all" ? "All repositories" : "Selected repositories"}
                {installation.connectedByLogin ? ` · Connected by ${installation.connectedByLogin}` : ""}
                {installation.reachable === false ? " · No longer installed on GitHub" : ""}
              </span>
            </div>
            <div className={styles.connectionActions}>
              <a className="ac-btn ac-btn-plain" href={installation.manageUrl} target="_blank" rel="noreferrer">
                Manage on GitHub
              </a>
              <button type="button" className="ac-btn ac-btn-plain" onClick={() => void connect()} disabled={busy}>
                Reconnect
              </button>
              <button type="button" className="ac-btn ac-btn-plain ac-danger" onClick={() => void disconnect()} disabled={busy}>
                Disconnect
              </button>
            </div>
          </li>
        </ul>
      )}
      {installation && installation.reachable !== false && <BackupControls key={installation.installationId} handle={handle} installation={installation} onStatus={setNotice} />}
    </section>
  );
}
