import { useEffect, useState } from "react";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { vaultRequest, type VaultFile, type VaultItem } from "./bridge";
import type { FolderPreview } from "./folder-collection";
import { ArticleReader } from "./ArticleReader";
import { readDocument, writePayload } from "./model";
import type { DocumentSnapshot } from "@/lib/documents/model";

function host(url?: string): string {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : "Saved link"; }
  catch { return "Saved link"; }
}
const PAGE_SIZE = 24;
type BookmarkFilter = "all" | "unread" | "favorites";

export function VaultBookmarkLibrary({ items, previews, busy, previewOnly, onOpen }: {
  items: VaultItem[]; previews: Record<string, FolderPreview>; busy: boolean; previewOnly: boolean; onOpen: (path: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState<BookmarkFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [flags, setFlags] = useState<Record<string, { favorite: boolean; readAt: string | null }>>({});
  const [metadata, setMetadata] = useState<Record<string, FolderPreview>>({});
  const [metadataState, setMetadataState] = useState<"reading" | "ready" | "unavailable">("reading");
  const [indexedKey, setIndexedKey] = useState("");
  const itemKey = JSON.stringify(items.map(item => item.path));
  useEffect(() => {
    let active = true;
    if (items.length > 2048) { queueMicrotask(() => { if (active) setMetadataState("unavailable"); }); return () => { active = false; }; }
    void (async () => {
      const found: Record<string, FolderPreview> = {};
      for (const item of items) {
        if (!active) return;
        try {
          const entry = await vaultRequest<FolderPreview>("preview", { path: item.path, metadataOnly: true });
          const incomplete = entry.incompleteFields || [];
          if (!entry.document || incomplete.some(field => ["*", "title", "content.fields.sourceUrl", "content.fields.texttextBookmarkFavorite", "content.fields.texttextBookmarkReadAt"].includes(field))) {
            if (active) setMetadataState("unavailable");
            return;
          }
          found[item.path] = entry;
        }
        catch { if (active) setMetadataState("unavailable"); return; }
      }
      if (active) { setMetadata(found); setIndexedKey(itemKey); setMetadataState("ready"); }
    })();
    return () => { active = false; };
    // itemKey represents the folder listing without re-reading on preview updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);
  const canFilter = metadataState === "ready" && indexedKey === itemKey;
  const filtered = canFilter ? items.filter(item => {
    const entry = metadata[item.path];
    const fields = entry?.document?.content.fields;
    const favorite = flags[item.path]?.favorite ?? Boolean(fields?.texttextBookmarkFavorite);
    const readAt = flags[item.path] ? flags[item.path].readAt : fields?.texttextBookmarkReadAt;
    const matchesStatus = filter === "all" || (filter === "favorites" ? favorite : !readAt);
    const text = `${entry?.title || item.title || ""} ${host(entry?.sourceURL)}`.toLocaleLowerCase();
    return matchesStatus && text.includes(search.trim().toLocaleLowerCase());
  }) : items;
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const shown = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const current = shown.find(item => item.path === selected) || shown[0];
  const preview = current && (previews[current.path] || metadata[current.path]);
  const [opened, setOpened] = useState<{ path: string; file: VaultFile; document: DocumentSnapshot; urls: string[] } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!current) return;
    let active = true;
    const controller = new AbortController();
    void vaultRequest<VaultFile>("read", { path: current.path }, controller.signal)
      .then(file => {
        if (!active) return;
        const urls: string[] = [];
        const replacements = new Map<string, string>();
        for (const asset of file.assets ?? []) {
          const bytes = Uint8Array.from(atob(asset.data), character => character.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: asset.contentType || "application/octet-stream" }));
          urls.push(url);
          replacements.set(`assets/${asset.filename}`, url);
          if (asset.remoteURL) replacements.set(asset.remoteURL, url);
        }
        let serialized = JSON.stringify(readDocument(file));
        for (const [source, target] of replacements) serialized = serialized.split(source).join(target);
        setOpened({ path: file.path, file, document: JSON.parse(serialized) as DocumentSnapshot, urls });
      }).catch(() => { if (active) setOpened(null); });
    return () => { active = false; controller.abort(); };
  }, [current?.path]);
  useEffect(() => () => { opened?.urls.forEach(url => URL.revokeObjectURL(url)); }, [opened?.urls]);
  const template = BUILTIN_TEMPLATES.find(item => item.id === "texttext.bookmark");
  const document = opened?.path === current?.path ? opened.document : null;
  const favorite = Boolean(document?.content.fields.texttextBookmarkFavorite);
  const readAt = typeof document?.content.fields.texttextBookmarkReadAt === "string" ? document.content.fields.texttextBookmarkReadAt : null;
  const changeFlag = async (field: "texttextBookmarkFavorite" | "texttextBookmarkReadAt") => {
    if (!opened || opened.path !== current?.path || updating || busy || previewOnly) return;
    setUpdating(true); setError("");
    try {
      const canonical = readDocument(opened.file);
      const nextFields = { ...canonical.content.fields, [field]: field === "texttextBookmarkFavorite" ? !Boolean(canonical.content.fields[field])
        : typeof canonical.content.fields[field] === "string" ? null : new Date().toISOString() };
      const updated = await vaultRequest<VaultFile>("write", writePayload(opened.file, { ...canonical, content: { ...canonical.content, fields: nextFields } }));
      setOpened(previous => previous?.path === updated.path ? { ...previous, file: updated, document: { ...previous.document, content: { ...previous.document.content, fields: nextFields } } } : previous);
      setFlags(previous => ({ ...previous, [updated.path]: { favorite: Boolean(nextFields.texttextBookmarkFavorite), readAt: typeof nextFields.texttextBookmarkReadAt === "string" ? nextFields.texttextBookmarkReadAt : null } }));
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Bookmark status could not be saved."); }
    finally { setUpdating(false); }
  };
  return <div className="vault-bookmark-library">
    <div className="vault-bookmark-list">
      <div className="vault-bookmark-toolbar"><label><span className="ac-sr-only">Filter bookmarks by title or site</span><input type="search" value={search} disabled={!canFilter} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Filter title or site" /></label><div role="group" aria-label="Bookmark filters">{(["all", "unread", "favorites"] as const).map(option => <button key={option} aria-pressed={filter === option} disabled={!canFilter} onClick={() => { setFilter(option); setPage(0); }}>{option === "all" ? "All" : option === "unread" ? "Unread" : "Favorites"}</button>)}</div></div>
      {metadataState === "reading" && <p role="status" className="vault-bookmark-index-status">Reading saved links for filters…</p>}
      {metadataState === "unavailable" && <p role="status" className="vault-bookmark-index-status">Filters are unavailable for this folder. Saved links remain accessible.</p>}
      <div className="vault-bookmark-day">{canFilter ? `${filtered.length} saved ${filtered.length === 1 ? "link" : "links"}` : "Saved links"}</div>
      <div role="listbox" aria-label="Saved bookmarks">{shown.map(item => { const entry = previews[item.path] || metadata[item.path]; const title = entry?.title || item.title || item.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Untitled";
        const itemFavorite = flags[item.path]?.favorite ?? Boolean(entry?.document?.content.fields.texttextBookmarkFavorite);
        const itemRead = flags[item.path] ? flags[item.path].readAt : (typeof entry?.document?.content.fields.texttextBookmarkReadAt === "string" ? entry.document.content.fields.texttextBookmarkReadAt : null);
        return <button role="option" aria-selected={current?.path === item.path} key={item.path} disabled={busy || previewOnly} onClick={() => setSelected(item.path)} onDoubleClick={() => onOpen(item.path)}>
          <span className="vault-bookmark-mark" aria-hidden="true">{host(entry?.sourceURL).slice(0, 1).toUpperCase()}</span>
          <span className="vault-bookmark-copy"><strong>{title}</strong><small>{host(entry?.sourceURL)}{itemRead ? " · Read" : ""}</small></span>{itemFavorite && <span className="vault-bookmark-favorite" aria-label="Favorite">★</span>}
        </button>; })}</div>
      {canFilter && !shown.length && <p className="vault-bookmark-index-status">No saved links match.</p>}
      {lastPage > 0 && <nav className="vault-bookmark-pages" aria-label="Bookmark pages"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {lastPage + 1}</span><button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
    </div>
    <article className="vault-bookmark-reader" aria-label="Bookmark reader">
      {current && <header><span>Reader</span><div><button disabled={busy || previewOnly || updating || !document} aria-pressed={favorite} onClick={() => void changeFlag("texttextBookmarkFavorite")}>{favorite ? "★ Favorite" : "☆ Favorite"}</button><button disabled={busy || previewOnly || updating || !document} onClick={() => void changeFlag("texttextBookmarkReadAt")}>{readAt ? "Mark unread" : "Mark read"}</button><button disabled={busy || previewOnly} onClick={() => onOpen(current.path)}>Edit</button>{preview?.sourceURL && <a href={preview.sourceURL} target="_blank" rel="noopener noreferrer">Original ↗</a>}</div></header>}
      {error && <p role="alert" className="vault-bookmark-error">{error}</p>}
      {document && template ? <ArticleReader document={document} template={template} /> : <p>{current ? "Reading saved page…" : "Save a link to start reading."}</p>}
    </article>
  </div>;
}
