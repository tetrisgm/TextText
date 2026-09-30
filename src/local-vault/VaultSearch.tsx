import { useEffect, useRef, useState } from "react";
import { vaultRequest } from "./bridge";
import { useEscapeLayer } from "./LocalKeyboard";

type SearchPage = { items: { path: string; title: string; snippet: string }[]; truncated?: boolean; skippedCount?: number };
export function VaultSearch({ onClose, onOpen }: { onClose: () => void; onOpen: (path: string) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchPage>({ items: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = useRef("");
  const inFlight = useRef<Promise<unknown> | null>(null);
  useEscapeLayer(true, "search", onClose);
  useEffect(() => {
    latest.current = query.trim();
    let active = true;
    const timer = setTimeout(() => { void (async () => {
      if (inFlight.current) await inFlight.current;
      if (!active) return;
      const requested = query.trim();
      if (!requested) { setResult({ items: [] }); setBusy(false); return; }
      setBusy(true); setError("");
      const request = vaultRequest<SearchPage>("search", { query: requested });
      inFlight.current = request.catch(() => {});
      try { const next = await request; if (active && latest.current === requested) setResult(next); }
      catch (error) { if (active) setError(error instanceof Error ? error.message : "Search could not finish."); }
      finally { if (active) setBusy(false); }
    })(); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  return <section className="vault-template-dialog vault-search" role="dialog" aria-modal="true" aria-label="Search files">
    <header><h2>Search files</h2><button onClick={onClose}>Close search</button></header>
    <input autoFocus type="search" aria-label="Search workspace" placeholder="Search names and text" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={500} />
    {busy && <p role="status">Searching…</p>}{error && <p role="alert">{error}</p>}
    {!busy && query.trim() && !result.items.length && !error && <p>No matching files.</p>}
    {!!result.skippedCount && <p>{result.skippedCount} files could not be searched.</p>}
    {result.truncated && <p>Search reached its size limit. Try more specific words.</p>}
    <div>{result.items.map((item) => <button key={item.path} onClick={() => { void onOpen(item.path).then(onClose).catch((error: Error) => setError(error.message)); }}><strong>{item.title}</strong><small>{item.path}</small><span>{item.snippet}</span></button>)}</div>
  </section>;
}
