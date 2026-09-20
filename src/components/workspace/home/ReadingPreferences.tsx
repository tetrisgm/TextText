"use client";

import { useEffect, useState } from "react";
import { fetchReadingHome, fetchReadingPreferences, removeReadingPreferenceRequest, setReadingPreferenceRequest, type HomeTopic, type ReadingPreferenceView } from "@/lib/reading/client";
import styles from "./Home.module.css";

export function ReadingPreferences({ handle, mode, onDone }: { handle: string; mode: "interests" | "hidden"; onDone: () => void }) {
  const [rules, setRules] = useState<ReadingPreferenceView[] | null>(null);
  const [topics, setTopics] = useState<HomeTopic[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([fetchReadingPreferences(handle), mode === "interests" ? fetchReadingHome({ handle, mode: "forYou", topic: null }) : Promise.resolve(null)])
      .then(([preferences, home]) => {
        if (!active) return;
        setRules(preferences.rules); setTopics(home?.topics ?? []);
        setSelected(new Set(preferences.rules.filter((rule) => rule.kind === "topic_more").map((rule) => rule.target)));
        setError(null);
      }).catch(() => { if (active) setError("Could not load your preferences. Try again."); });
    return () => { active = false; };
  }, [handle, mode, attempt]);
  const save = async () => {
    if (!rules) return;
    setBusy(true); setError(null);
    try {
      const old = rules.filter((rule) => rule.kind === "topic_more");
      for (const rule of old) if (!selected.has(rule.target)) await removeReadingPreferenceRequest(handle, rule.id);
      for (const topic of topics) if (selected.has(topic.id) && !old.some((rule) => rule.target === topic.id)) await setReadingPreferenceRequest(handle, { kind: "topic_more", target: topic.id, label: topic.label });
      onDone();
    } catch { setError("Some preferences could not be saved. Try again."); }
    finally { setBusy(false); }
  };
  const restore = async (rule: ReadingPreferenceView) => {
    setBusy(true); setError(null);
    try { await removeReadingPreferenceRequest(handle, rule.id); setRules((current) => current?.filter((entry) => entry.id !== rule.id) ?? null); }
    catch { setError("Could not restore this item. Try again."); }
    finally { setBusy(false); }
  };
  const hidden = rules?.filter((rule) => rule.kind === "source_hidden" || rule.kind === "article_hidden") ?? [];
  return <div className={styles.preferences}>
    {error && <p role="alert">{error} {!rules && <button className={styles.back} onClick={() => setAttempt((value) => value + 1)}>Try again</button>}</p>}
    {!rules ? !error && <p role="status">Loading…</p> : mode === "interests" ? <>
      <p>Choose what you want to see more of.</p>
      <div className={styles.interestChips}>{topics.map((topic) => <button key={topic.id} aria-pressed={selected.has(topic.id)} disabled={busy} onClick={() => setSelected((current) => { const next = new Set(current); if (next.has(topic.id)) next.delete(topic.id); else next.add(topic.id); return next; })}>{topic.label}</button>)}</div>
      {!topics.length && <p>Add publishers to start choosing interests.</p>}
      <button className={styles.primaryButton} onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Done"}</button>
    </> : hidden.length ? <ul className={styles.profileList}>{hidden.map((rule) => <li key={rule.id}><button disabled={busy} onClick={() => void restore(rule)}><span>{rule.label}</span><span>Show again</span></button></li>)}</ul> : <p>Publishers and articles you hide appear here.</p>}
  </div>;
}
