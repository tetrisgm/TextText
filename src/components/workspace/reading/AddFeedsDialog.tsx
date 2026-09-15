"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { addFeed, discoverFeeds, type FeedCandidate } from "@/lib/reading/client";
import styles from "./Reading.module.css";

/**
 * Add feeds: address in, verified candidates out, then follow the chosen
 * ones. Retention and the size of the first import are shown before anything
 * is created, because both are decisions about what will live in the
 * workspace, not settings to discover later.
 */

const RETENTION_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "One year" },
  { value: 0, label: "Until I delete them" },
];

export function AddFeedsDialog({
  handle,
  parentFolderPath,
  parentFolderName,
  defaultRetentionDays,
  onClose,
  onAdded,
}: {
  handle: string;
  parentFolderPath: string;
  parentFolderName: string;
  defaultRetentionDays: number;
  onClose: () => void;
  onAdded: (result: { folderPath: string; folderName: string; created: boolean }) => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const [input, setInput] = useState("");
  const [finding, setFinding] = useState(false);
  const [candidates, setCandidates] = useState<Array<FeedCandidate & { chosen: boolean }>>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [retention, setRetention] = useState<number>(
    RETENTION_OPTIONS.some((option) => option.value === defaultRetentionDays) ? defaultRetentionDays : 90,
  );
  const [initialImport, setInitialImport] = useState(100);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>("textarea, input, button");
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const find = useCallback(async () => {
    const lines = input
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20);
    if (lines.length === 0) return;
    setFinding(true);
    setError(null);
    setDetail(null);
    try {
      const found: Array<FeedCandidate & { chosen: boolean }> = [];
      const seen = new Set<string>();
      let lastDetail: string | null = null;
      for (const line of lines) {
        const result = await discoverFeeds(handle, line);
        lastDetail = result.detail;
        for (const candidate of result.candidates) {
          if (seen.has(candidate.url)) continue;
          seen.add(candidate.url);
          found.push({ ...candidate, chosen: candidate.verified });
        }
      }
      setCandidates(found);
      if (found.length === 0) setDetail(lastDetail ?? "No feeds found at that address.");
      else if (found.length === 1) setName(found[0].title);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not look for feeds");
    } finally {
      setFinding(false);
    }
  }, [handle, input]);

  const chosen = candidates.filter((candidate) => candidate.chosen && candidate.verified);

  const add = useCallback(async () => {
    if (chosen.length === 0) return;
    setAdding(true);
    setError(null);
    let first: { folderPath: string; folderName: string; created: boolean } | null = null;
    try {
      for (const [index, candidate] of chosen.entries()) {
        setProgress(`Adding ${index + 1} of ${chosen.length}: ${candidate.title}`);
        const result = await addFeed({
          handle,
          parentFolderPath,
          url: candidate.url,
          name: chosen.length === 1 && name.trim() ? name.trim() : candidate.title,
          retentionDays: retention,
          initialImportLimit: initialImport,
        });
        first ??= { folderPath: result.folder.path, folderName: result.folder.name, created: result.created };
      }
      if (first) onAdded(first);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the feed");
    } finally {
      setAdding(false);
      setProgress(null);
    }
  }, [chosen, handle, initialImport, name, onAdded, parentFolderPath, retention]);

  return (
    <div
      className={`applecms ${styles.backdrop}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.panelHeader}>
          <div>
            <h2 id={titleId}>Add feeds</h2>
            <p>Each feed becomes its own folder in {parentFolderName}.</p>
          </div>
          <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className={styles.panelBody}>
          <label className={styles.field}>
            Feed or site address, one per line
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={"https://example.com/feed.xml\nhttps://another.example"}
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void find();
                }
              }}
            />
          </label>
          <div className={styles.controls}>
            <button type="button" className={styles.button} onClick={() => void find()} disabled={finding || !input.trim()}>
              {finding ? "Looking…" : "Find feeds"}
            </button>
            {detail && <p className={styles.note}>{detail}</p>}
          </div>
          {candidates.length > 0 && (
            <ul className={styles.candidates} aria-label="Feeds found">
              {candidates.map((candidate) => (
                <li key={candidate.url} className={styles.candidate}>
                  <input
                    type="checkbox"
                    checked={candidate.chosen}
                    disabled={!candidate.verified}
                    aria-label={`Follow ${candidate.title}`}
                    onChange={(event) =>
                      setCandidates((current) =>
                        current.map((entry) =>
                          entry.url === candidate.url ? { ...entry, chosen: event.target.checked } : entry,
                        ),
                      )
                    }
                  />
                  <div>
                    <strong>{candidate.title}</strong>
                    <small>
                      {new URL(candidate.url).hostname}
                      {candidate.verified
                        ? ` · ${candidate.format} · ${candidate.entryCount} ${candidate.entryCount === 1 ? "entry" : "entries"}`
                        : ` · ${candidate.detail ?? "Could not verify"}`}
                    </small>
                    {candidate.sampleTitles.length > 0 && (
                      <ul>
                        {candidate.sampleTitles.map((title) => (
                          <li key={title}>{title}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {chosen.length > 0 && (
            <>
              <div className={styles.settings}>
                {chosen.length === 1 && (
                  <label className={styles.field}>
                    Folder name
                    <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
                  </label>
                )}
                <label className={styles.field}>
                  Keep articles for
                  <select value={retention} onChange={(event) => setRetention(Number(event.target.value))}>
                    {RETENTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  First import, most recent
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={initialImport}
                    onChange={(event) => setInitialImport(Math.max(1, Math.min(500, Number(event.target.value) || 1)))}
                  />
                </label>
              </div>
              <p className={styles.note}>
                {retention === 0
                  ? "Articles stay until you delete them."
                  : `Articles you have not starred, kept, or commented on can be cleaned up ${retention} days after they arrive. Anything you use in your own notes is kept.`}
              </p>
            </>
          )}
          {progress && <p className={styles.note} role="status">{progress}</p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
        <footer className={styles.panelFooter}>
          <button type="button" className={styles.button} onClick={onClose} disabled={adding}>
            Cancel
          </button>
          <button type="button" className={styles.primary} onClick={() => void add()} disabled={adding || chosen.length === 0}>
            {adding ? "Adding…" : chosen.length > 1 ? `Add ${chosen.length} feeds` : "Add feed"}
          </button>
        </footer>
      </section>
    </div>
  );
}
