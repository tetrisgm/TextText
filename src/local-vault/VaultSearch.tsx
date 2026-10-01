import { useEffect, useRef, useState } from "react";
import { vaultRequest } from "./bridge";
import { useEscapeLayer } from "./LocalKeyboard";

type SearchPage = { items: { path: string; title: string; snippet: string }[]; truncated?: boolean; skippedCount?: number };
export type VaultSearchAction = { id: string; label: string; description: string; keywords?: readonly string[] };

export function filterVaultSearchActions(actions: readonly VaultSearchAction[], query: string): VaultSearchAction[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...actions];
  return actions.filter((action) => {
    const text = [action.label, action.description, ...(action.keywords ?? [])].join(" ").toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export function VaultSearch({ onClose, onOpen, onAction, actions = [], namesOnly = false }: {
  onClose: () => void;
  onOpen: (path: string) => Promise<void>;
  onAction: (action: VaultSearchAction) => void | Promise<void>;
  actions?: readonly VaultSearchAction[];
  namesOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchPage>({ items: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false);
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
  const visibleActions = filterVaultSearchActions(actions, query);
  const runAction = (action: VaultSearchAction) => {
    if (acting) return;
    setActing(true); setError("");
    void Promise.resolve(onAction(action)).then(onClose).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "That action could not finish.");
    }).finally(() => setActing(false));
  };
  return <section className="vault-template-dialog vault-search" role="dialog" aria-modal="true" aria-label="Search and actions">
    <header><h2>Search and actions</h2><button disabled={acting} onClick={onClose}>Close</button></header>
    <input autoFocus type="search" aria-label="Search workspace" placeholder={namesOnly ? "Search filenames, folders, and actions" : "Search files and actions"} value={query} onChange={(event) => setQuery(event.target.value)} maxLength={500} />
    {namesOnly && <p>Searches filenames and folder paths in this workspace.</p>}
    {!!visibleActions.length && <section aria-label="Actions"><h3>Actions</h3><div>{visibleActions.map((action) => <button
      key={action.id} aria-label={action.label} disabled={acting} onClick={() => runAction(action)}>
      <strong>{action.label}</strong><span>{action.description}</span>
    </button>)}</div></section>}
    {busy && <p role="status">Searching…</p>}{error && <p role="alert">{error}</p>}
    {!busy && query.trim() && !result.items.length && !visibleActions.length && !error && <p>No matching files or actions.</p>}
    {!!result.skippedCount && <p>{result.skippedCount} files could not be searched.</p>}
    {result.truncated && <p>Search reached its size limit. Try more specific words.</p>}
    <div>{result.items.map((item) => <button key={item.path} onClick={() => { void onOpen(item.path).then(onClose).catch((error: Error) => setError(error.message)); }}><strong>{item.title}</strong><small>{item.path}</small><span>{item.snippet}</span></button>)}</div>
  </section>;
}
