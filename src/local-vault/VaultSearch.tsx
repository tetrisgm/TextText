import { useEffect, useRef, useState } from "react";
import { vaultRequest } from "./bridge";
import { useEscapeLayer } from "./LocalKeyboard";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";

type SearchPage = { items: { path: string; title: string; snippet: string }[]; truncated?: boolean; skippedCount?: number };
export type VaultSearchAction = { id: string; label: string; description: string; shortcut?: string; keywords?: readonly string[] };

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
  const [activeIndex, setActiveIndex] = useState(0);
  const latest = useRef("");
  const dialog = useRef<HTMLElement>(null);
  const inFlight = useRef<Promise<unknown> | null>(null);
  useEscapeLayer(true, "search", onClose);
  useDialogFocus(dialog, true);
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
  const choices = [
    ...visibleActions.map(action => ({ id: `action:${action.id}`, run: () => runAction(action) })),
    ...result.items.map(item => ({ id: `file:${item.path}`, run: () => { void onOpen(item.path).then(onClose).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not open that file.")); } })),
  ];
  const selectedIndex = Math.min(activeIndex, Math.max(0, choices.length - 1));
  const runAction = (action: VaultSearchAction) => {
    if (acting) return;
    setActing(true); setError("");
    void Promise.resolve(onAction(action)).then(onClose).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "That action could not finish.");
    }).finally(() => setActing(false));
  };
  return <div className="vault-search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialog} className="vault-template-dialog vault-search" role="dialog" aria-modal="true" aria-label="Search and actions">
    <header><h2>TextText Command</h2><button disabled={acting} onClick={onClose} aria-label="Close command menu">Esc</button></header>
    <input autoFocus type="search" role="combobox" aria-expanded={choices.length > 0} aria-controls="vault-command-results" aria-activedescendant={choices[selectedIndex]?.id} aria-label="Search workspace" placeholder={namesOnly ? "Search filenames, folders, and actions" : "Search files and actions"} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => {
      if (event.key === "ArrowDown" && choices.length) { event.preventDefault(); setActiveIndex((selectedIndex + 1) % choices.length); }
      if (event.key === "ArrowUp" && choices.length) { event.preventDefault(); setActiveIndex((selectedIndex + choices.length - 1) % choices.length); }
      if (event.key === "Enter" && choices.length) { event.preventDefault(); choices[selectedIndex].run(); }
    }} maxLength={500} />
    {namesOnly && <p>Searches filenames and folder paths in this workspace.</p>}
    <div id="vault-command-results" role="listbox">{!!visibleActions.length && <section aria-label="Actions"><h3>Actions</h3><div>{visibleActions.map((action, index) => <button
      id={`action:${action.id}`} key={action.id} role="option" aria-selected={selectedIndex === index} aria-label={action.label} disabled={acting} onMouseEnter={() => setActiveIndex(index)} onClick={() => runAction(action)}>
      <strong>{action.label}</strong><span>{action.description}</span>{action.shortcut && <kbd aria-label={`${action.shortcut} shortcut`}>{action.shortcut}</kbd>}
    </button>)}</div></section>}
    {busy && <p role="status">Searching…</p>}{error && <p role="alert">{error}</p>}
    {!busy && query.trim() && !result.items.length && !visibleActions.length && !error && <p>No matching files or actions.</p>}
    {!!result.skippedCount && <p>{result.skippedCount} files could not be searched.</p>}
    {result.truncated && <p>Search reached its size limit. Try more specific words.</p>}
    <div>{result.items.map((item, index) => <button id={`file:${item.path}`} key={item.path} role="option" aria-selected={selectedIndex === visibleActions.length + index} onMouseEnter={() => setActiveIndex(visibleActions.length + index)} onClick={() => { void onOpen(item.path).then(onClose).catch((error: Error) => setError(error.message)); }}><strong>{item.title}</strong><small>{item.path}</small><span>{item.snippet}</span></button>)}</div></div>
  </section></div>;
}
