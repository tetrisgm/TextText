"use client";

import { useEffect, useState } from "react";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { writerOf } from "./document-history-writer";
import type { Post } from "@/lib/content";
import styles from "./DocumentHistory.module.css";

/**
 * Earlier versions of one document, and putting one back.
 *
 * Each entry is a version some write replaced, recorded by the same statement
 * that replaced it. A version that lost text is marked, because that is the
 * one someone comes here looking for.
 */

type Version = {
  id: string;
  revision: number | null;
  title: string | null;
  bodyLength: number;
  shrankBy: number;
  action: string;
  actorType: string;
  createdAt: string;
  preview: string;
};

function when(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function DocumentHistoryDialog({
  handle,
  post,
  onClose,
  onRestored,
}: {
  handle: string;
  post: Post;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Version | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/workspace/history?handle=${encodeURIComponent(handle)}&id=${encodeURIComponent(post.id ?? "")}`, { cache: "no-store" });
        const data = (await response.json()) as { versions?: Version[]; error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error ?? "Could not read the history");
        setVersions(data.versions ?? []);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not read the history");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, post.id]);

  const restore = async (version: Version) => {
    setConfirming(null);
    setBusy(version.id);
    setNotice(null);
    try {
      const response = await fetch("/api/workspace/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, id: post.id, versionId: version.id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not restore that version");
      setNotice("Restored. The open editor has it too.");
      onRestored?.();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not restore that version");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={`applecms ${styles.backdrop}`}
      role="presentation"
      // Only a press on the backdrop itself closes this. React sends events
      // from a portalled child (the confirmation) up the component tree, so a
      // press on the confirm button used to close the history out from under
      // it and the restore never ran.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Earlier versions" onMouseDown={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <div>
            <strong>Earlier versions</strong>
            <span>Versions kept for this item, newest first. Frequent edits are grouped, and anything that replaced text is always kept.</span>
          </div>
          <button type="button" className="ac-btn ac-btn-plain" onClick={onClose}>
            Done
          </button>
        </header>
        <div className={styles.body}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.note} role="status">{notice}</p>}
        {versions === null && !error && <p className={styles.note}>Reading the history.</p>}
        {versions !== null && versions.length === 0 && (
          <p className={styles.note}>No earlier versions yet. One is kept the first time something replaces this document&apos;s text.</p>
        )}
        {versions !== null && versions.length > 0 && (
          <ul className={styles.list}>
            {versions.map((version) => (
              <li key={version.id} className={styles.row} data-lost={version.shrankBy > 0 ? "true" : "false"}>
                <div>
                  <strong>
                    {when(version.createdAt)}
                    {version.shrankBy > 0 ? ` · ${version.shrankBy} characters removed` : ""}
                  </strong>
                  <small>
                    {writerOf(version)} · {version.bodyLength} characters
                    {version.title ? ` · ${version.title}` : ""}
                  </small>
                  <p>{expanded === version.id ? version.preview : version.preview.slice(0, 90)}</p>
                </div>
                <div className={styles.actions}>
                  <button type="button" className="ac-btn ac-btn-plain" onClick={() => setExpanded(expanded === version.id ? null : version.id)}>
                    {expanded === version.id ? "Less" : "More"}
                  </button>
                  <button type="button" className="ac-btn ac-btn-plain" disabled={busy !== null} onClick={() => setConfirming(version)}>
                    {busy === version.id ? "Restoring" : "Put this back"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        </div>
      </div>
      <ConfirmationDialog
        open={confirming !== null}
        title="Put this version back?"
        message="The text it replaces is kept here too, so this can be undone."
        confirmLabel="Put this back"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const version = confirming;
          if (version) void restore(version);
        }}
      />
    </div>
  );
}
