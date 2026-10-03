"use client";

import { useEffect, useState } from "react";
import { vaultRequest, type VaultFile, type VaultListing } from "./bridge";
import { packIdentity } from "./pack";

type Result = { path: string; title: string };
export type CardLinkTarget = { id: string; title: string };
const cardTitle = (entry: Result) => entry.title.endsWith(".textpack") ? entry.title.split("/").at(-1)!.replace(/\.textpack$/i, "") : entry.title;

export function VaultCardLinkPicker({ onPick, onCancel }: { onPick: (target: CardLinkTarget) => void; onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!query.trim()) {
      void vaultRequest<VaultListing>("list", {}, controller.signal)
        .then(list => { if (active) { setResults(list.items.filter(item => item.path.startsWith("Notes/") && item.path.endsWith(".textpack")).slice(0, 20).map(item => ({ path: item.path, title: item.title || item.path.split("/").at(-1)!.replace(/\.textpack$/i, "") }))); setResultsFor(""); } })
        .catch(reason => { if (active && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Cards could not be listed."); });
      return () => { active = false; controller.abort(); };
    }
    const timer = setTimeout(() => {
      void vaultRequest<{ items: Result[] }>("search", { query: query.trim(), folder: "Notes" }, controller.signal)
        .then(page => { if (active) { const needle = query.trim().toLocaleLowerCase(); setResults(page.items.filter(item => item.path.startsWith("Notes/") && item.path.endsWith(".textpack")).sort((left, right) => Number(cardTitle(right).toLocaleLowerCase() === needle) - Number(cardTitle(left).toLocaleLowerCase() === needle)).slice(0, 20)); setResultsFor(query.trim()); } })
        .catch(reason => { if (active && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Cards could not be searched."); });
    }, 100);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [query]);
  const pick = async (entry: Result) => {
    setBusy(true); setError("");
    try {
      const file = await vaultRequest<VaultFile>("read", { path: entry.path });
      if (!file.path.startsWith("Notes/")) throw new Error("This card moved. Search again.");
      onPick({ id: packIdentity(file.markdown), title: cardTitle(entry) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The card could not be opened."); }
    finally { setBusy(false); }
  };
  return <div className="tt-card-link-picker" role="group" aria-label="Link to a card" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}>
    <input autoFocus type="search" aria-label="Find a card to link" placeholder="Search cards" value={query} onChange={event => { setQuery(event.target.value); setResults([]); setResultsFor(null); setError(""); }} />
    {resultsFor === query.trim() && !!results.length && <div className="tt-card-link-results">{results.map(entry => <button type="button" key={entry.path} disabled={busy} onClick={() => void pick(entry)}><strong>{cardTitle(entry)}</strong><small>{entry.path}</small></button>)}</div>}
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={onCancel}>Cancel</button>
  </div>;
}
