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
          <p>Install the TextText app on your GitHub account to back this workspace up to a repository you own. Sign-in with GitHub is separate and lives under Account.</p>
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
    </section>
  );
}
