import { useEffect, useRef, useState } from "react";
import { vaultRequest, type VaultFile, type VaultItem } from "./bridge";
import type { FolderPreview } from "./folder-collection";
import { ArticleReader } from "./ArticleReader";
import { readDocument, readTemplate, writePayload } from "./model";
import type { DocumentSnapshot } from "@/lib/documents/model";

function host(url?: string): string {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : "Saved link"; }
  catch { return "Saved link"; }
}
const PAGE_SIZE = 24;
type BookmarkFilter = "inbox" | "unread" | "favorites" | "archive";
type BookmarkFlags = { favorite: boolean; readAt: string | null; archivedAt: string | null; tags?: string[] };

function savedTime(entry?: FolderPreview): number {
  const fields = entry?.document?.content.fields;
  const value = fields?.texttextBookmarkSavedAt ?? fields?.capturedAt;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function savedDay(timestamp: number): string {
  if (!timestamp) return "Saved links";
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  if (sameDay(date, today)) return "Today";
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) }).format(date);
}

export function VaultBookmarkLibrary({ items, previews, busy, previewOnly, onOpen, preferredPath }: {
  items: VaultItem[]; previews: Record<string, FolderPreview>; busy: boolean; previewOnly: boolean; onOpen: (path: string) => void; preferredPath?: string;
}) {
  const [selected, setSelected] = useState(preferredPath || "");
  const pendingPreferred = useRef(preferredPath || "");
  useEffect(() => { if (preferredPath) { pendingPreferred.current = preferredPath; setSelected(preferredPath); setFilter("inbox"); setSearch(""); setTagFilter(""); } }, [preferredPath]);
  const [filter, setFilter] = useState<BookmarkFilter>("inbox");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [page, setPage] = useState(0);
  const [flags, setFlags] = useState<Record<string, BookmarkFlags>>({});
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
          if (!entry.document || incomplete.some(field => ["*", "title", "tags", "content.fields.sourceUrl", "content.fields.texttextBookmarkFavorite", "content.fields.texttextBookmarkReadAt", "content.fields.texttextBookmarkArchivedAt"].includes(field))) {
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
  const tags = canFilter ? [...new Set(items.flatMap(item => flags[item.path]?.tags ?? metadata[item.path]?.document?.content.tags ?? []))].sort((left, right) => left.localeCompare(right)) : [];
  const filtered = canFilter ? items.filter(item => {
    const entry = metadata[item.path];
    const fields = entry?.document?.content.fields;
    const favorite = flags[item.path]?.favorite ?? Boolean(fields?.texttextBookmarkFavorite);
    const readAt = flags[item.path] ? flags[item.path].readAt : fields?.texttextBookmarkReadAt;
    const archivedAt = flags[item.path] ? flags[item.path].archivedAt : fields?.texttextBookmarkArchivedAt;
    const matchesStatus = filter === "favorites" ? favorite : filter === "archive" ? Boolean(archivedAt) : filter === "unread" ? !archivedAt && !readAt : !archivedAt;
    const matchesTag = !tagFilter || (flags[item.path]?.tags ?? entry?.document?.content.tags ?? []).includes(tagFilter);
    const text = `${entry?.title || item.title || ""} ${host(entry?.sourceURL)}`.toLocaleLowerCase();
    return matchesStatus && matchesTag && text.includes(search.trim().toLocaleLowerCase());
  }).sort((left, right) => savedTime(metadata[right.path]) - savedTime(metadata[left.path])) : items;
  const preferredIndex = preferredPath ? filtered.findIndex(item => item.path === preferredPath) : -1;
  useEffect(() => {
    if (pendingPreferred.current === preferredPath && filter === "inbox" && !search && !tagFilter && preferredIndex >= 0) {
      setPage(Math.floor(preferredIndex / PAGE_SIZE));
      pendingPreferred.current = "";
    }
  }, [filter, preferredIndex, preferredPath, search, tagFilter]);
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const shown = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const groups = shown.reduce<{ label: string; items: VaultItem[] }[]>((result, item) => {
    const label = savedDay(savedTime(metadata[item.path]));
    const last = result.at(-1);
    if (last?.label === label) last.items.push(item);
    else result.push({ label, items: [item] });
    return result;
  }, []);
  const current = shown.find(item => item.path === selected) || shown[0];
  const currentIndex = current ? shown.findIndex(item => item.path === current.path) : -1;
  const preview = current && (previews[current.path] || metadata[current.path]);
  const [opened, setOpened] = useState<{ path: string; file: VaultFile; document: DocumentSnapshot; urls: string[] } | null>(null);
  const readerFiles = useRef(new Map<string, VaultFile>());
  const readerWrites = useRef<Promise<void>>(Promise.resolve());
  const readerPending = useRef(0);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [editingNotePath, setEditingNotePath] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
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
  const document = opened && current && opened.path === current.path ? opened.document : null;
  let template = null;
  if (document && opened) {
    try { template = readTemplate(opened.file, readDocument(opened.file)); }
    catch { /* A missing or invalid look leaves the saved file available through Edit. */ }
  }
  const favorite = Boolean(document?.content.fields.texttextBookmarkFavorite);
  const readAt = typeof document?.content.fields.texttextBookmarkReadAt === "string" ? document.content.fields.texttextBookmarkReadAt : null;
  const archivedAt = typeof document?.content.fields.texttextBookmarkArchivedAt === "string" ? document.content.fields.texttextBookmarkArchivedAt : null;
  const personalNote = typeof document?.content.fields.texttextBookmarkNote === "string" ? document.content.fields.texttextBookmarkNote : "";
  const noteIsEditing = Boolean(current && editingNotePath === current.path);
  const updateReader = (transform: (snapshot: DocumentSnapshot) => DocumentSnapshot) => {
    if (!opened || opened.path !== current?.path || busy || previewOnly) return;
    const path = opened.path;
    setOpened(previous => previous?.path === path ? { ...previous, document: transform(previous.document) } : previous);
    readerPending.current += 1;
    setUpdating(true); setError("");
    readerWrites.current = readerWrites.current.catch(() => {}).then(async () => {
      try {
        const file = readerFiles.current.get(path) ?? opened.file;
        const canonical = readDocument(file);
        const updated = await vaultRequest<VaultFile>("write", writePayload(file, transform(canonical)));
        readerFiles.current.set(path, updated);
        setOpened(previous => previous?.path === path ? { ...previous, file: updated } : previous);
        window.dispatchEvent(new Event("texttext:vault-changed"));
      } catch (reason) { setError(reason instanceof Error ? reason.message : "The highlight could not be saved."); }
      finally { readerPending.current -= 1; if (!readerPending.current) { readerFiles.current.clear(); setUpdating(false); } }
    });
  };
  const saveNote = async () => {
    if (!opened || opened.path !== current?.path || updating || busy || previewOnly) return;
    setUpdating(true); setError("");
    try {
      const canonical = readDocument(opened.file);
      const nextFields = { ...canonical.content.fields, texttextBookmarkNote: noteDraft.trim() };
      const updated = await vaultRequest<VaultFile>("write", writePayload(opened.file, { ...canonical, content: { ...canonical.content, fields: nextFields } }));
      setOpened(previous => previous?.path === updated.path ? { ...previous, file: updated, document: { ...previous.document, content: { ...previous.document.content, fields: nextFields } } } : previous);
      setEditingNotePath("");
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Your note could not be saved."); }
    finally { setUpdating(false); }
  };
  const changeFlag = async (field: "texttextBookmarkFavorite" | "texttextBookmarkReadAt" | "texttextBookmarkArchivedAt") => {
    if (!opened || opened.path !== current?.path || updating || busy || previewOnly) return;
    setUpdating(true); setError("");
    try {
      const canonical = readDocument(opened.file);
      const nextFields = { ...canonical.content.fields, [field]: field === "texttextBookmarkFavorite" ? !Boolean(canonical.content.fields[field])
        : typeof canonical.content.fields[field] === "string" ? null : new Date().toISOString() };
      const updated = await vaultRequest<VaultFile>("write", writePayload(opened.file, { ...canonical, content: { ...canonical.content, fields: nextFields } }));
      setOpened(previous => previous?.path === updated.path ? { ...previous, file: updated, document: { ...previous.document, content: { ...previous.document.content, fields: nextFields } } } : previous);
      setFlags(previous => ({ ...previous, [updated.path]: { favorite: Boolean(nextFields.texttextBookmarkFavorite), readAt: typeof nextFields.texttextBookmarkReadAt === "string" ? nextFields.texttextBookmarkReadAt : null, archivedAt: typeof nextFields.texttextBookmarkArchivedAt === "string" ? nextFields.texttextBookmarkArchivedAt : null, tags: previous[updated.path]?.tags } }));
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Bookmark status could not be saved."); }
    finally { setUpdating(false); }
  };
  const changeTags = async (nextTags: string[]) => {
    if (!opened || opened.path !== current?.path || updating || busy || previewOnly) return;
    setUpdating(true); setError("");
    try {
      const canonical = readDocument(opened.file);
      const updated = await vaultRequest<VaultFile>("write", writePayload(opened.file, { ...canonical, content: { ...canonical.content, tags: nextTags } }));
      setOpened(previous => previous?.path === updated.path ? { ...previous, file: updated, document: { ...previous.document, content: { ...previous.document.content, tags: nextTags } } } : previous);
      setFlags(previous => ({ ...previous, [updated.path]: { favorite: Boolean(canonical.content.fields.texttextBookmarkFavorite), readAt: typeof canonical.content.fields.texttextBookmarkReadAt === "string" ? canonical.content.fields.texttextBookmarkReadAt : null, archivedAt: typeof canonical.content.fields.texttextBookmarkArchivedAt === "string" ? canonical.content.fields.texttextBookmarkArchivedAt : null, tags: nextTags } }));
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Bookmark tags could not be saved."); }
    finally { setUpdating(false); }
  };
  return <div className="vault-bookmark-library">
    <div className="vault-bookmark-list">
      <div className="vault-bookmark-toolbar"><label><span className="ac-sr-only">Filter bookmarks by title or site</span><input type="search" value={search} disabled={!canFilter} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Filter title or site" /></label><div role="group" aria-label="Bookmark filters">{(["inbox", "unread", "favorites", "archive"] as const).map(option => <button key={option} aria-pressed={filter === option} disabled={!canFilter} onClick={() => { setFilter(option); setPage(0); }}>{option === "inbox" ? "Inbox" : option === "unread" ? "Unread" : option === "archive" ? "Archive" : "Favorites"}</button>)}</div>{(tags.length > 0 || tagFilter) && <div className="vault-bookmark-tag-filters" role="group" aria-label="Filter bookmark tags"><button aria-pressed={!tagFilter} onClick={() => { setTagFilter(""); setPage(0); }}>All tags</button>{tags.map(tag => <button key={tag} aria-pressed={tagFilter === tag} onClick={() => { setTagFilter(tag); setPage(0); }}>#{tag}</button>)}</div>}</div>
      {metadataState === "reading" && <p role="status" className="vault-bookmark-index-status">Reading saved links for filters…</p>}
      {metadataState === "unavailable" && <p role="status" className="vault-bookmark-index-status">Filters are unavailable for this folder. Saved links remain accessible.</p>}
      <div role="listbox" aria-label="Saved bookmarks">{groups.map(group => <div role="group" aria-label={group.label} key={group.label}><div className="vault-bookmark-day">{group.label}</div>{group.items.map(item => { const entry = previews[item.path] || metadata[item.path]; const title = entry?.title || item.title || item.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Untitled";
        const itemFavorite = flags[item.path]?.favorite ?? Boolean(entry?.document?.content.fields.texttextBookmarkFavorite);
        const itemRead = flags[item.path] ? flags[item.path].readAt : (typeof entry?.document?.content.fields.texttextBookmarkReadAt === "string" ? entry.document.content.fields.texttextBookmarkReadAt : null);
        return <button role="option" aria-selected={current?.path === item.path} key={item.path} disabled={busy || previewOnly} onClick={() => setSelected(item.path)} onDoubleClick={() => onOpen(item.path)}>
          <span className="vault-bookmark-mark" aria-hidden="true">{host(entry?.sourceURL).slice(0, 1).toUpperCase()}</span>
          <span className="vault-bookmark-copy"><strong>{title}</strong><small>{host(entry?.sourceURL)}{itemRead ? " · Read" : ""}</small></span>{itemFavorite && <span className="vault-bookmark-favorite" aria-label="Favorite">★</span>}
        </button>; })}</div>)}</div>
      {canFilter && !shown.length && <p className="vault-bookmark-index-status">No saved links match.</p>}
      {lastPage > 0 && <nav className="vault-bookmark-pages" aria-label="Bookmark pages"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {lastPage + 1}</span><button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
    </div>
    <article className="vault-bookmark-reader" aria-label="Bookmark reader">
      {current && <header><div className="vault-bookmark-reader-navigation"><button aria-label="Previous bookmark" title="Previous bookmark" disabled={busy || currentIndex <= 0} onClick={() => setSelected(shown[currentIndex - 1].path)}>‹</button><button aria-label="Next bookmark" title="Next bookmark" disabled={busy || currentIndex >= shown.length - 1} onClick={() => setSelected(shown[currentIndex + 1].path)}>›</button></div><div className="vault-bookmark-reader-tabs"><span aria-current="page">Reader</span>{preview?.sourceURL && <a href={preview.sourceURL} target="_blank" rel="noopener noreferrer">Original ↗</a>}</div><div className="vault-bookmark-reader-actions"><button disabled={busy || previewOnly || updating || !document} aria-pressed={favorite} onClick={() => void changeFlag("texttextBookmarkFavorite")}>{favorite ? "★ Favorite" : "☆ Favorite"}</button><button disabled={busy || previewOnly || updating || !document} onClick={() => void changeFlag("texttextBookmarkReadAt")}>{readAt ? "Mark unread" : "Mark read"}</button><button disabled={busy || previewOnly || updating || !document} onClick={() => void changeFlag("texttextBookmarkArchivedAt")}>{archivedAt ? "Move to inbox" : "Archive"}</button><button disabled={busy || previewOnly} onClick={() => onOpen(current.path)}>Edit</button></div><details className="vault-bookmark-inspector"><summary aria-label="Bookmark details" title="Bookmark details">•••</summary><div className="vault-bookmark-inspector-panel">
      {document && <div className="vault-bookmark-tags" aria-label="Bookmark tags"><span>Tags</span>{document.content.tags.map(tag => <button key={tag} type="button" disabled={busy || previewOnly || updating} aria-label={`Remove ${tag} tag`} onClick={() => void changeTags(document.content.tags.filter(value => value !== tag))}>#{tag} ×</button>)}<form onSubmit={event => { event.preventDefault(); const tag = tagDraft.trim().replace(/^#/, "").slice(0, 40); if (!tag || document.content.tags.some(value => value.toLocaleLowerCase() === tag.toLocaleLowerCase())) return; void changeTags([...document.content.tags, tag]); setTagDraft(""); }}><input aria-label="Add bookmark tag" value={tagDraft} onChange={event => setTagDraft(event.target.value)} placeholder="Add tag" maxLength={41} disabled={busy || previewOnly || updating} /><button type="submit" disabled={busy || previewOnly || updating || !tagDraft.trim()}>Add</button></form></div>}
      {document && <section className="vault-bookmark-note" aria-label="Personal note"><div><strong>My note</strong>{!noteIsEditing && !previewOnly && <button type="button" disabled={busy || updating} onClick={() => { setNoteDraft(personalNote); setEditingNotePath(current?.path ?? ""); }}>{personalNote ? "Edit note" : "Add note"}</button>}</div>{noteIsEditing ? <form onSubmit={event => { event.preventDefault(); void saveNote(); }}><textarea autoFocus aria-label="Personal note text" value={noteDraft} onChange={event => setNoteDraft(event.target.value)} maxLength={10000} disabled={busy || updating} placeholder="What do you want to remember?" /><div><button type="button" disabled={updating} onClick={() => setEditingNotePath("")}>Cancel</button><button type="submit" disabled={busy || updating || noteDraft.trim() === personalNote}>{updating ? "Saving…" : "Save note"}</button></div></form> : personalNote && <p>{personalNote}</p>}</section>}
      </div></details></header>}
      {error && <p role="alert" className="vault-bookmark-error">{error}</p>}
      {document && template ? <ArticleReader document={document} template={template} update={previewOnly || busy ? undefined : updateReader} /> : <p>{current ? "Reading saved page…" : "Save a link to start reading."}</p>}
    </article>
  </div>;
}
