import { useEffect, useRef, useState } from "react";
import { vaultRequest } from "./bridge";
import { useEscapeLayer } from "./LocalKeyboard";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";

type SearchPage = { items: { path: string; title: string; snippet: string }[]; truncated?: boolean; skippedCount?: number };
export type VaultSearchAction = { id: string; label: string; description: string; shortcut?: string; keywords?: readonly string[]; aliases?: readonly string[]; searchOnly?: boolean };

function oneEditAway(query: string, candidate: string): boolean {
  if (query.length < 4 || Math.abs(query.length - candidate.length) > 1) return false;
  if (query.length === candidate.length) {
    const first = [...query].findIndex((character, index) => character !== candidate[index]);
    if (first >= 0 && first + 1 < query.length && query[first] === candidate[first + 1] && query[first + 1] === candidate[first] && query.slice(first + 2) === candidate.slice(first + 2)) return true;
  }
  let left = 0, right = 0, edits = 0;
  while (left < query.length && right < candidate.length) {
    if (query[left] === candidate[right]) { left++; right++; continue; }
    if (++edits > 1) return false;
    if (query.length >= candidate.length) left++;
    if (candidate.length >= query.length) right++;
  }
  return edits + Number(left < query.length || right < candidate.length) <= 1;
}

function wordScore(word: string, text: string): number {
  const lower = text.toLocaleLowerCase();
  if (lower === word) return 8;
  if (lower.startsWith(word)) return 6;
  const tokens = lower.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.some(token => token.startsWith(word))) return 4;
  if (tokens.some(token => oneEditAway(word, token))) return 2;
  return 0;
}

const actionIcons: Record<string, string> = {
  "new-note": "✎", "write-story": "▤", "save-bookmark": "◇", capture: "↗",
  "new-from-template": "▧", "import-images": "▣", "subscribe-feed": "◌",
  "import-file": "⇧", "folder-design": "▦", customize: "◈", "add-agent": "✧",
  "trash-recovery": "↺", "open-folder": "▱",
  "go-home": "⌂", "edit-current": "✎",
  "share-current": "↗", "show-comments": "☷", "publish-current": "◎", "version-history": "◷",
  "rename-current": "✎", "delete-current": "⌫",
};

export function filterVaultSearchActions(actions: readonly VaultSearchAction[], query: string): VaultSearchAction[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return actions.filter(action => !action.searchOnly);
  return actions.map((action, index) => {
    const score = words.reduce((total, word) => {
      const best = Math.max(wordScore(word, action.label) * 3, ...([...(action.keywords ?? []), ...(action.aliases ?? [])].map(keyword => wordScore(word, keyword) * 2)), wordScore(word, action.description));
      return total < 0 || best === 0 ? -1 : total + best;
    }, 0);
    return { action, index, score };
  }).filter(entry => entry.score >= 0).sort((left, right) => right.score - left.score || left.index - right.index).map(entry => entry.action);
}

function matchingAlias(action: VaultSearchAction, query: string): string | null {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || words.every(word => wordScore(word, action.label) > 0)) return null;
  return action.aliases?.find(alias => words.every(word => wordScore(word, alias) > 0)) ?? null;
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
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const latest = useRef("");
  const dialog = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const shortcutsBack = useRef<HTMLButtonElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const shortcutList = useRef<HTMLDivElement>(null);
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
  const shortcutAction: VaultSearchAction = { id: "show-shortcuts", label: "Keyboard shortcuts", description: "Learn the keys for available actions.", keywords: ["shortcuts", "keys", "help"] };
  const visibleActions = showShortcuts ? [] : filterVaultSearchActions([...actions, shortcutAction], query);
  useEffect(() => { if (showShortcuts && shortcutList.current) shortcutList.current.scrollTop = 0; }, [showShortcuts]);
  useEffect(() => {
    (showShortcuts ? shortcutsBack.current : searchInput.current)?.focus({ preventScroll: true });
  }, [showShortcuts]);
  const choices = [
    ...visibleActions.map(action => ({ id: `action:${action.id}`, run: () => runAction(action) })),
    ...result.items.map(item => ({ id: `file:${item.path}`, run: () => { void onOpen(item.path).then(onClose).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not open that file.")); } })),
  ];
  const selectedIndex = Math.min(activeIndex, Math.max(0, choices.length - 1));
  const selectedChoiceId = choices[selectedIndex]?.id;
  useEffect(() => {
    const list = results.current;
    const option = selectedChoiceId && Array.from(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? []).find(entry => entry.id === selectedChoiceId);
    if (!list || !option) return;
    const listBounds = list.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    if (optionBounds.top < listBounds.top) list.scrollTop += optionBounds.top - listBounds.top;
    else if (optionBounds.bottom > listBounds.bottom) list.scrollTop += optionBounds.bottom - listBounds.bottom;
  }, [selectedChoiceId]);
  const runAction = (action: VaultSearchAction) => {
    if (action.id === "show-shortcuts") { setQuery(""); setResult({ items: [] }); setActiveIndex(0); setShowShortcuts(true); return; }
    if (acting) return;
    setActing(true); setError("");
    void Promise.resolve(onAction(action)).then(onClose).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "That action could not finish.");
    }).finally(() => setActing(false));
  };
  return <div className="vault-search-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialog} className="vault-template-dialog vault-search" role="dialog" aria-modal="true" aria-label="Search and actions">
    <header><span className="vault-command-mark" aria-hidden="true">⌘</span><h2>{showShortcuts ? "Keyboard shortcuts" : "TextText Command"}</h2>{showShortcuts && <button ref={shortcutsBack} className="vault-command-back" onClick={() => setShowShortcuts(false)} aria-label="Back to commands">Back</button>}<button disabled={acting} onClick={onClose} aria-label="Close command menu">Esc</button></header>
    {!showShortcuts && <input ref={searchInput} autoFocus type="search" role="combobox" aria-expanded={choices.length > 0} aria-controls="vault-command-results" aria-activedescendant={choices[selectedIndex]?.id} aria-label="Search workspace" placeholder={namesOnly ? "Search filenames, folders, and actions" : "Search files and actions"} value={query} onChange={(event) => { latest.current = event.target.value.trim(); setQuery(event.target.value); setResult({ items: [] }); setActiveIndex(0); }} onKeyDown={(event) => {
      if (event.key === "ArrowDown" && choices.length) { event.preventDefault(); setActiveIndex((selectedIndex + 1) % choices.length); }
      if (event.key === "ArrowUp" && choices.length) { event.preventDefault(); setActiveIndex((selectedIndex + choices.length - 1) % choices.length); }
      if (event.key === "Enter" && choices.length) { event.preventDefault(); choices[selectedIndex].run(); }
    }} maxLength={500} />}
    {!showShortcuts && namesOnly && <p>Searches filenames and folder paths in this workspace.</p>}
    {showShortcuts ? <div ref={shortcutList} className="vault-shortcuts-list" aria-label="Available keyboard shortcuts">{actions.filter(action => action.shortcut).map(action => <div key={action.id}><span>{action.label}</span><kbd>{action.shortcut}</kbd></div>)}</div> : <div ref={results} id="vault-command-results" role="listbox">{!!visibleActions.length && <section aria-label="Actions"><h3>Actions</h3><div>{visibleActions.map((action, index) => <button
      id={`action:${action.id}`} key={action.id} role="option" aria-selected={selectedIndex === index} aria-label={action.label} disabled={acting} onMouseEnter={() => setActiveIndex(index)} onClick={() => runAction(action)}>
      <i className="vault-command-icon" aria-hidden="true">{actionIcons[action.id] || (action.id.startsWith("go-to-folder:") ? "▱" : "·")}</i><strong>{action.label}{matchingAlias(action, query) && <em> ({matchingAlias(action, query)})</em>}</strong><span className="ac-sr-only">{action.description}</span>{action.shortcut && <kbd aria-label={`${action.shortcut} shortcut`}>{action.shortcut}</kbd>}
    </button>)}</div></section>}
    {busy && <p role="status">Searching…</p>}{error && <p role="alert">{error}</p>}
    {!busy && query.trim() && !result.items.length && !visibleActions.length && !error && <p>No matching files or actions.</p>}
    {!!result.skippedCount && <p>{result.skippedCount} files could not be searched.</p>}
    {result.truncated && <p>Search reached its size limit. Try more specific words.</p>}
    {!!result.items.length && <section aria-label="Files"><h3>Files</h3><div>{result.items.map((item, index) => <button className="vault-command-file" id={`file:${item.path}`} key={item.path} role="option" aria-selected={selectedIndex === visibleActions.length + index} aria-label={`${item.title}, ${item.path}`} onMouseEnter={() => setActiveIndex(visibleActions.length + index)} onClick={() => { void onOpen(item.path).then(onClose).catch((error: Error) => setError(error.message)); }}><i className="vault-command-icon" aria-hidden="true">▤</i><strong>{item.title}</strong><small title={item.path}>{item.path}</small><span className="ac-sr-only">{item.snippet}</span></button>)}</div></section>}</div>}
  </section></div>;
}
