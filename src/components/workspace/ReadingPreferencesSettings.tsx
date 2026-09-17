"use client";

import { useEffect, useState } from "react";
import { clearReadingPreferencesRequest, fetchReadingPreferences, removeReadingPreferenceRequest, type ReadingPreferenceView } from "@/lib/reading/client";
import styles from "./WorkspaceSettings.module.css";

/**
 * The whole taste profile, in the open: every rule For you applies, each
 * undoable, and the count of hidden Summaries with one way to bring them
 * all back. Nothing here reaches Latest, folders, search, or digests.
 */

const KIND_COPY: Record<ReadingPreferenceView["kind"], (label: string) => string> = {
  topic_more: (label) => `More about ${label}`,
  topic_less: (label) => `Less about ${label}`,
  source_less: (label) => `Less from ${label}`,
};

export function ReadingPreferencesSettings({ handle }: { handle: string }) {
  const [rules, setRules] = useState<ReadingPreferenceView[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchReadingPreferences(handle)
      .then((data) => {
        if (cancelled) return;
        setRules(data.rules);
        setHidden(data.hidden);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [handle]);

  if (rules === null || (rules.length === 0 && hidden === 0)) return null;

  const remove = async (rule: ReadingPreferenceView) => {
    setBusy(rule.id);
    try {
      await removeReadingPreferenceRequest(handle, rule.id);
      setRules((current) => (current ?? []).filter((entry) => entry.id !== rule.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove the rule");
    } finally {
      setBusy(null);
    }
  };
  const clear = async () => {
    if (!window.confirm("Remove every reading rule and show every hidden Summary again?")) return;
    setBusy("clear");
    try {
      const result = await clearReadingPreferencesRequest(handle);
      setRules([]);
      setHidden(0);
      setNotice(`Cleared ${result.rules} ${result.rules === 1 ? "rule" : "rules"} and ${result.hidden} hidden ${result.hidden === 1 ? "Summary" : "Summaries"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not clear");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.section} id="settings-reading" aria-labelledby="settings-reading-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="settings-reading-title">Reading preferences</h2>
          <p>What shapes For you on the home page: your rules, and the Summaries you hid. These change the ranking only. Latest, folders, search, digests, and your feed apps see everything.</p>
        </div>
        <button type="button" className="ac-btn ac-btn-plain ac-danger" onClick={() => void clear()} disabled={busy !== null}>
          Reset
        </button>
      </div>
      {notice && (
        <p className={styles.aiNotConfigured} role="status">
          {notice}
        </p>
      )}
      {rules.length > 0 && (
        <ul className={styles.connectionList}>
          {rules.map((rule) => (
            <li className={styles.connectionRow} key={rule.id}>
              <div className={styles.connectionMain}>
                <span className={styles.connectionName}>{KIND_COPY[rule.kind](rule.label)}</span>
                <span className={styles.connectionMeta}>Since {new Date(rule.createdAt).toLocaleDateString()}</span>
              </div>
              <div className={styles.connectionActions}>
                <button type="button" className="ac-btn ac-btn-plain" onClick={() => void remove(rule)} disabled={busy === rule.id}>
                  Undo
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <p className={styles.aiNotConfigured}>
          {hidden} hidden {hidden === 1 ? "Summary" : "Summaries"}. Reset shows them again.
        </p>
      )}
    </section>
  );
}
