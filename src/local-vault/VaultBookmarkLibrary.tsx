import { useEffect, useRef, useState } from "react";
import { vaultRequest, type VaultFile, type VaultItem } from "./bridge";
import type { FolderPreview } from "./folder-collection";
import { ArticleReader } from "./ArticleReader";
import { captureInput } from "./CaptureDialog";
import { readDocument, readTemplate, writePayload } from "./model";
import type { DocumentFieldValue, DocumentSnapshot } from "@/lib/documents/model";
import type { DocumentFieldDefinition } from "@/lib/presentation/schema";
import { articleSource, isLinkPlaceholder } from "@/lib/vault/article-capture";
import { enrichArticleFile } from "./article-enrichment";

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

export function VaultBookmarkLibrary({ items, previews, busy, previewOnly, onOpen, onQuickSave, preferredPath }: {
  items: VaultItem[]; previews: Record<string, FolderPreview>; busy: boolean; previewOnly: boolean; onOpen: (path: string) => void; onQuickSave?: (address: string) => Promise<void>; preferredPath?: string;
}) {
  const [selected, setSelected] = useState(preferredPath || "");
  const [compactReaderOpen, setCompactReaderOpen] = useState(Boolean(preferredPath));
  const pendingPreferred = useRef(preferredPath || "");
  const [filter, setFilter] = useState<BookmarkFilter>("inbox");
  const [search, setSearch] = useState("");
  const [contentSearch, setContentSearch] = useState<{ query: string; paths: Set<string>; searching: boolean; truncated: boolean; error: string }>({ query: "", paths: new Set(), searching: false, truncated: false, error: "" });
  const [tagFilter, setTagFilter] = useState("");
  useEffect(() => {
    if (!preferredPath) return;
    let live = true;
    pendingPreferred.current = preferredPath;
    queueMicrotask(() => { if (live) { setSelected(preferredPath); setCompactReaderOpen(true); setFilter("inbox"); setSearch(""); setTagFilter(""); } });
    return () => { live = false; };
  }, [preferredPath]);
  const [tagDraft, setTagDraft] = useState("");
  const [quickLink, setQuickLink] = useState("");
  const [showQuickSave, setShowQuickSave] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState("");
  const saveQuickLink = async () => {
    if (!onQuickSave || quickSaving || busy) return;
    setQuickSaving(true); setQuickError("");
    try {
      const address = quickLink.trim() || (await navigator.clipboard.readText()).trim();
      if (!address) throw new Error("Copy a web address or enter one first.");
      await onQuickSave(address);
      setQuickLink("");
      setShowQuickSave(false);
    } catch (reason) { setQuickError(reason instanceof Error ? reason.message : "Could not save this link."); }
    finally { setQuickSaving(false); }
  };
  const [page, setPage] = useState(0);
  const bookmarkList = useRef<HTMLDivElement>(null);
  const pendingKeyboardFocus = useRef("");
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
  const searchQuery = search.trim();
  useEffect(() => {
    if (!searchQuery) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void vaultRequest<{ items: { path: string }[]; truncated?: boolean; skippedCount?: number }>("search", { query: searchQuery, folder: "Bookmarks" }, controller.signal)
        .then(page => setContentSearch({ query: searchQuery, paths: new Set(page.items.map(item => item.path)), searching: false, truncated: Boolean(page.truncated || page.skippedCount), error: "" }))
        .catch(reason => { if (!controller.signal.aborted) setContentSearch({ query: searchQuery, paths: new Set(), searching: false, truncated: false, error: reason instanceof Error ? reason.message : "Search could not finish." }); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchQuery]);
  const searchReady = !searchQuery || contentSearch.query === searchQuery && !contentSearch.searching && !contentSearch.error;
  const tags = canFilter ? [...new Set(items.flatMap(item => flags[item.path]?.tags ?? metadata[item.path]?.document?.content.tags ?? []))].sort((left, right) => left.localeCompare(right)) : [];
  const filtered = canFilter ? items.filter(item => {
    const entry = metadata[item.path];
    const fields = entry?.document?.content.fields;
    const favorite = flags[item.path]?.favorite ?? Boolean(fields?.texttextBookmarkFavorite);
    const readAt = flags[item.path] ? flags[item.path].readAt : fields?.texttextBookmarkReadAt;
    const archivedAt = flags[item.path] ? flags[item.path].archivedAt : fields?.texttextBookmarkArchivedAt;
    const matchesStatus = filter === "favorites" ? favorite : filter === "archive" ? Boolean(archivedAt) : filter === "unread" ? !archivedAt && !readAt : !archivedAt;
    const matchesTag = !tagFilter || (flags[item.path]?.tags ?? entry?.document?.content.tags ?? []).includes(tagFilter);
    const localText = `${entry?.title || item.title || ""} ${entry?.sourceURL || ""} ${entry?.excerpt || ""} ${(flags[item.path]?.tags ?? entry?.document?.content.tags ?? []).join(" ")}`.toLocaleLowerCase();
    return matchesStatus && matchesTag && (!searchQuery || localText.includes(searchQuery.toLocaleLowerCase()) || searchReady && contentSearch.paths.has(item.path));
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
  useEffect(() => {
    if (!pendingKeyboardFocus.current || current?.path !== pendingKeyboardFocus.current) return;
    bookmarkList.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus({ preventScroll: true });
    pendingKeyboardFocus.current = "";
  }, [current?.path, currentPage]);
  const currentFilteredIndex = current ? filtered.findIndex(item => item.path === current.path) : -1;
  const navigateReader = (offset: number) => {
    const nextIndex = currentFilteredIndex + offset;
    if (nextIndex < 0 || nextIndex >= filtered.length) return;
    setPage(Math.floor(nextIndex / PAGE_SIZE));
    setSelected(filtered[nextIndex].path);
  };
  const selectBookmark = (path: string) => { setSelected(path); setCompactReaderOpen(true); };
  const preview = current && (previews[current.path] || metadata[current.path]);
  const [opened, setOpened] = useState<{ path: string; file: VaultFile; document: DocumentSnapshot; urls: string[] } | null>(null);
  const readerFiles = useRef(new Map<string, VaultFile>());
  const readerWrites = useRef<Promise<void>>(Promise.resolve());
  const readerPending = useRef(0);
  const readerDraft = useRef<{ path: string; file: VaultFile; transform: (snapshot: DocumentSnapshot) => DocumentSnapshot } | null>(null);
  const readerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushReaderDraftRef = useRef<() => void>(() => {});
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [readerRevision, setReaderRevision] = useState(0);
  const [retryingCapture, setRetryingCapture] = useState(false);
  const [editingNotePath, setEditingNotePath] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [editingSummaryPath, setEditingSummaryPath] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [editingField, setEditingField] = useState("");
  const [fieldDraft, setFieldDraft] = useState("");
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
  }, [current?.path, readerRevision]);
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
  const summary = document?.content.subtitle ?? "";
  const savedProgress = document?.content.fields.texttextFeedReadingProgress;
  const resumeProgress = document?.content.fields.texttextFeedEntry === "v1" && !readAt &&
    typeof savedProgress === "number" && Number.isInteger(savedProgress) && savedProgress >= 15 && savedProgress < 90 ? savedProgress : 0;
  const resumeReading = () => {
    const scroller = window.document.querySelector<HTMLElement>(".vault-app>main");
    const content = scroller?.querySelector<HTMLElement>(".vault-bookmark-reader .tt-document");
    if (!scroller || !content || !resumeProgress) return;
    const viewport = scroller.getBoundingClientRect();
    const bounds = content.getBoundingClientRect();
    const targetTop = scroller.scrollTop + bounds.top - viewport.bottom + Math.max(bounds.height, viewport.height) * resumeProgress / 100;
    scroller.scrollTop = Math.max(0, Math.min(targetTop, scroller.scrollHeight - scroller.clientHeight));
    const blocks = content.querySelectorAll<HTMLElement>(".tt-prose p,.tt-prose h2,.tt-prose h3,.tt-prose li,.tt-prose blockquote");
    const visible = [...blocks].find(block => block.getBoundingClientRect().bottom > viewport.top + 32);
    if (visible) { visible.tabIndex = -1; visible.focus({ preventScroll: true }); }
  };
  const captureStatus = document?.content.fields.captureStatus;
  const captureFailed = captureStatus === "failed" || document?.content.fields.captureMediaStatus === "failed";
  const linkPlaceholder = document && articleSource(document) && isLinkPlaceholder(document.content.body, articleSource(document)!);
  const retryCapture = async () => {
    if (!opened || opened.path !== current?.path || updating || busy || previewOnly) return;
    const path = opened.path;
    setRetryingCapture(true); setUpdating(true); setError("");
    try {
      flushReaderDraft();
      await readerWrites.current;
      const latest = await vaultRequest<VaultFile>("read", { path });
      const canonical = readDocument(latest);
      if (!articleSource(canonical)) throw new Error("This bookmark no longer has a valid source link.");
      const fields = { ...canonical.content.fields,
        ...(canonical.content.fields.captureStatus === "complete" ? { captureMediaStatus: "pending" } : { captureStatus: "pending" }) };
      await vaultRequest<VaultFile>("write", writePayload(latest, { ...canonical, content: { ...canonical.content, fields } }));
      const outcome = await enrichArticleFile(path, vaultRequest);
      readerFiles.current.set(path, await vaultRequest<VaultFile>("read", { path }));
      if (outcome === "failed") setError("The page could not be captured. Your link is saved; try again later.");
      else if (outcome === "skipped") setError("The bookmark changed during capture. The latest version was kept.");
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not capture this page. Your link is saved."); }
    finally { setReaderRevision(value => value + 1); setRetryingCapture(false); setUpdating(false); }
  };
  const customFields = template?.fields.filter(field => field.visibility !== "hidden" && !["cover", "sourceUrl", "sourceLabel", "links"].includes(field.id)) ?? [];
  const noteIsEditing = Boolean(current && editingNotePath === current.path);
  const saveCustomField = async (field: DocumentFieldDefinition) => {
    if (!opened || opened.path !== current?.path || updating || busy || previewOnly) return;
    const raw = fieldDraft.trim();
    let value: DocumentFieldValue = raw || null;
    if (field.type === "number" && raw) {
      const number = Number(raw);
      if (!Number.isFinite(number) || field.min !== undefined && number < field.min || field.max !== undefined && number > field.max) { setError("Enter a number within the allowed range."); return; }
      value = number;
    } else if (field.type === "boolean") {
      value = raw === "true";
    } else if (field.type === "url" && raw) {
      try { const url = new URL(raw); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
      catch { setError("Enter a web address beginning with http or https."); return; }
    } else if (field.type === "enum" && raw && !field.options.some(option => option.value === raw)) {
      setError("Choose an available option."); return;
    }
    if (field.required && value === null) { setError(`${field.label} is required.`); return; }
    setUpdating(true); setError("");
    try {
      const canonical = readDocument(opened.file);
      const fields = { ...canonical.content.fields, [field.id]: value };
      const updated = await vaultRequest<VaultFile>("write", writePayload(opened.file, { ...canonical, content: { ...canonical.content, fields } }));
      setOpened(previous => previous?.path === updated.path ? { ...previous, file: updated, document: { ...previous.document, content: { ...previous.document.content, fields } } } : previous);
      setEditingField("");
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The detail could not be saved."); }
    finally { setUpdating(false); }
  };
  const queueReaderWrite = (path: string, file: VaultFile, transform: (snapshot: DocumentSnapshot) => DocumentSnapshot) => {
    readerPending.current += 1; setUpdating(true); setError("");
    readerWrites.current = readerWrites.current.catch(() => {}).then(async () => {
      try {
        const latest = readerFiles.current.get(path) ?? file;
        const canonical = readDocument(latest);
        const updated = await vaultRequest<VaultFile>("write", writePayload(latest, transform(canonical)));
        readerFiles.current.set(path, updated);
        setOpened(previous => previous?.path === path ? { ...previous, file: updated } : previous);
        window.dispatchEvent(new Event("texttext:vault-changed"));
      } catch (reason) { setError(reason instanceof Error ? reason.message : "The highlight could not be saved."); }
      finally { readerPending.current -= 1; if (!readerPending.current) setUpdating(false); }
    });
  };
  const flushReaderDraft = () => {
    if (readerTimer.current) clearTimeout(readerTimer.current);
    readerTimer.current = null;
    const draft = readerDraft.current;
    readerDraft.current = null;
    if (draft) queueReaderWrite(draft.path, draft.file, draft.transform);
  };
  const updateReader = (transform: (snapshot: DocumentSnapshot) => DocumentSnapshot, mode?: "debounced") => {
    if (!opened || opened.path !== current?.path || busy || previewOnly) return;
    const path = opened.path;
    setOpened(previous => previous?.path === path ? { ...previous, document: transform(previous.document) } : previous);
    if (mode === "debounced") {
      readerDraft.current = { path, file: opened.file, transform };
      if (readerTimer.current) clearTimeout(readerTimer.current);
      readerTimer.current = setTimeout(flushReaderDraft, 350);
    } else {
      flushReaderDraft();
      queueReaderWrite(path, opened.file, transform);
    }
  };
  useEffect(() => { flushReaderDraftRef.current = flushReaderDraft; });
  useEffect(() => () => { flushReaderDraftRef.current(); }, [current?.path]);
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
  const saveSummary = async () => {
    if (!opened || opened.path !== current?.path || updating || busy || previewOnly) return;
    setUpdating(true); setError("");
    try {
      await readerWrites.current;
      const latest = await vaultRequest<VaultFile>("read", { path: opened.path });
      const canonical = readDocument(latest);
      const subtitle = summaryDraft.trim();
      const updated = await vaultRequest<VaultFile>("write", writePayload(latest, { ...canonical, content: { ...canonical.content, subtitle } }));
      setOpened(previous => previous?.path === updated.path ? { ...previous, file: updated, document: { ...previous.document, content: { ...previous.document.content, subtitle } } } : previous);
      setEditingSummaryPath("");
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The summary could not be saved."); }
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
  const readerActions = (compact: boolean) => <div className={compact ? "vault-bookmark-inspector-actions" : "vault-bookmark-reader-actions"}>{document && (captureFailed || linkPlaceholder) && !previewOnly && <button type="button" disabled={busy || updating || retryingCapture} onClick={() => void retryCapture()}>{retryingCapture ? "Reading page…" : captureFailed ? "Retry capture" : "Read page now"}</button>}<button disabled={busy || previewOnly || updating || !document} aria-pressed={favorite} onClick={() => void changeFlag("texttextBookmarkFavorite")}>{favorite ? "★ Favorite" : "☆ Favorite"}</button><button disabled={busy || previewOnly || updating || !document} onClick={() => void changeFlag("texttextBookmarkReadAt")}>{readAt ? "Mark unread" : "Mark read"}</button><button disabled={busy || previewOnly || updating || !document} onClick={() => void changeFlag("texttextBookmarkArchivedAt")}>{archivedAt ? "Move to inbox" : "Archive"}</button><button disabled={busy || previewOnly} onClick={() => onOpen(current!.path)}>Edit</button></div>;
  return <div className="vault-bookmark-library" data-compact-reader={compactReaderOpen ? "open" : "list"} onPaste={event => {
    if (!onQuickSave || busy || previewOnly || quickSaving || (event.target as HTMLElement).closest("input,textarea,[contenteditable=true]")) return;
    const pasted = event.clipboardData.getData("text/plain").trim();
    try {
      if (!captureInput(pasted, "").sourceURL) return;
    } catch { return; }
    event.preventDefault();
    void (async () => {
      setQuickSaving(true); setQuickError("");
      try { await onQuickSave(pasted); }
      catch (reason) { setShowQuickSave(true); setQuickLink(pasted); setQuickError(reason instanceof Error ? reason.message : "Could not save this link."); }
      finally { setQuickSaving(false); }
    })();
  }}>
    <div className="vault-bookmark-list">
      {onQuickSave && !previewOnly && (showQuickSave ? <form className="vault-bookmark-quick-save" onSubmit={event => { event.preventDefault(); void saveQuickLink(); }}><label><span className="ac-sr-only">Web address to save</span><input autoFocus type="text" inputMode="url" autoCapitalize="none" spellCheck={false} aria-label="Web address to save" placeholder="Paste a link to save" value={quickLink} disabled={quickSaving || busy} onChange={event => setQuickLink(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setShowQuickSave(false); setQuickError(""); } }} maxLength={4096} /></label><button type="submit" disabled={quickSaving || busy}>{quickSaving ? "Saving…" : quickLink.trim() ? "Save" : "Save copied link"}</button><button type="button" className="vault-bookmark-save-cancel" disabled={quickSaving} onClick={() => { setShowQuickSave(false); setQuickError(""); }}>Cancel</button>{quickError && <p role="alert">{quickError}</p>}</form> : <button className="vault-bookmark-add-link" type="button" onClick={() => setShowQuickSave(true)}>+ Add link</button>)}
      <div className="vault-bookmark-toolbar"><label><span className="ac-sr-only">Search saved links</span><input type="search" value={search} disabled={!canFilter} onChange={event => { setSearch(event.target.value); setContentSearch(previous => ({ ...previous, searching: true })); setPage(0); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (search) { setSearch(""); setPage(0); } else event.currentTarget.blur(); } }} placeholder="Search saved links" /></label><div role="group" aria-label="Bookmark filters">{(["inbox", "unread", "favorites", "archive"] as const).map(option => <button key={option} aria-pressed={filter === option} disabled={!canFilter} onClick={() => { setFilter(option); setPage(0); }}>{option === "inbox" ? "Inbox" : option === "unread" ? "Unread" : option === "archive" ? "Archive" : "Favorites"}</button>)}</div>{(tags.length > 0 || tagFilter) && <div className="vault-bookmark-tag-filters" role="group" aria-label="Filter bookmark tags"><button aria-pressed={!tagFilter} onClick={() => { setTagFilter(""); setPage(0); }}>All tags</button>{tags.map(tag => <button key={tag} aria-pressed={tagFilter === tag} onClick={() => { setTagFilter(tag); setPage(0); }}>#{tag}</button>)}</div>}</div>
      {searchQuery && !searchReady && !contentSearch.error && <p role="status" className="vault-bookmark-index-status">Searching saved articles…</p>}
      {searchQuery && contentSearch.query === searchQuery && contentSearch.error && <p role="alert" className="vault-bookmark-index-status">{contentSearch.error}</p>}
      {searchQuery && contentSearch.query === searchQuery && contentSearch.truncated && <p role="status" className="vault-bookmark-index-status">Search reached its limit. Try more specific words.</p>}
      {metadataState === "reading" && <p role="status" className="vault-bookmark-index-status">Reading saved links for filters…</p>}
      {metadataState === "unavailable" && <p role="status" className="vault-bookmark-index-status">Filters are unavailable for this folder. Saved links remain accessible.</p>}
      <div ref={bookmarkList} role="listbox" aria-label="Saved bookmarks">{groups.map(group => <div role="group" aria-label={group.label} key={group.label}><div className="vault-bookmark-day">{group.label}</div>{group.items.map(item => { const entry = previews[item.path] || metadata[item.path]; const title = entry?.title || item.title || item.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Untitled";
        const itemFavorite = flags[item.path]?.favorite ?? Boolean(entry?.document?.content.fields.texttextBookmarkFavorite);
        const itemRead = flags[item.path] ? flags[item.path].readAt : (typeof entry?.document?.content.fields.texttextBookmarkReadAt === "string" ? entry.document.content.fields.texttextBookmarkReadAt : null);
        return <button role="option" aria-selected={current?.path === item.path} key={item.path} disabled={busy || previewOnly} onClick={() => selectBookmark(item.path)} onDoubleClick={() => onOpen(item.path)} onKeyDown={event => {
          const itemIndex = filtered.findIndex(entry => entry.path === item.path);
          const nextIndex = event.key === "ArrowDown" ? itemIndex + 1
            : event.key === "ArrowUp" ? itemIndex - 1
            : event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : -1;
          if (nextIndex < 0 || nextIndex >= filtered.length) return;
          event.preventDefault();
          pendingKeyboardFocus.current = filtered[nextIndex].path;
          setPage(Math.floor(nextIndex / PAGE_SIZE));
          selectBookmark(filtered[nextIndex].path);
        }}>
          <span className="vault-bookmark-mark" aria-hidden="true">{host(entry?.sourceURL).slice(0, 1).toUpperCase()}</span>
          <span className="vault-bookmark-copy"><strong>{title}</strong><small>{host(entry?.sourceURL)}{itemRead ? " · Read" : ""}</small></span>{itemFavorite && <span className="vault-bookmark-favorite" aria-label="Favorite">★</span>}
        </button>; })}</div>)}</div>
      {canFilter && searchReady && !shown.length && <p className="vault-bookmark-index-status">No saved links match.</p>}
      {lastPage > 0 && <nav className="vault-bookmark-pages" aria-label="Bookmark pages"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {lastPage + 1}</span><button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
    </div>
    <article className="vault-bookmark-reader" aria-label="Bookmark reader">
      {current && <header><div className="vault-bookmark-reader-navigation"><button className="vault-bookmark-reader-close" aria-label="Back to bookmarks" onClick={() => { setCompactReaderOpen(false); requestAnimationFrame(() => bookmarkList.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus({ preventScroll: true })); }}>‹ <span>Bookmarks</span></button><button aria-label="Previous bookmark" title="Previous bookmark" disabled={busy || currentFilteredIndex <= 0} onClick={() => navigateReader(-1)}>‹</button><button aria-label="Next bookmark" title="Next bookmark" disabled={busy || currentFilteredIndex >= filtered.length - 1} onClick={() => navigateReader(1)}>›</button></div><div className="vault-bookmark-reader-tabs"><span aria-current="page">Reader</span>{preview?.sourceURL && <a href={preview.sourceURL} target="_blank" rel="noopener noreferrer">Original ↗</a>}</div>{readerActions(false)}<details key={current.path} className="vault-bookmark-inspector"><summary aria-label="Bookmark details" title="Bookmark details">•••</summary><div className="vault-bookmark-inspector-panel">
      {readerActions(true)}
      {document && <div className="vault-bookmark-tags" aria-label="Bookmark tags"><span>Tags</span>{document.content.tags.map(tag => <button key={tag} type="button" disabled={busy || previewOnly || updating} aria-label={`Remove ${tag} tag`} onClick={() => void changeTags(document.content.tags.filter(value => value !== tag))}>#{tag} ×</button>)}<form onSubmit={event => { event.preventDefault(); const tag = tagDraft.trim().replace(/^#/, "").slice(0, 40); if (!tag || document.content.tags.some(value => value.toLocaleLowerCase() === tag.toLocaleLowerCase())) return; void changeTags([...document.content.tags, tag]); setTagDraft(""); }}><input aria-label="Add bookmark tag" value={tagDraft} onChange={event => setTagDraft(event.target.value)} placeholder="Add tag" maxLength={41} disabled={busy || previewOnly || updating} /><button type="submit" disabled={busy || previewOnly || updating || !tagDraft.trim()}>Add</button></form></div>}
      {document && <section className="vault-bookmark-summary-editor" aria-label="Bookmark summary"><div><strong>Summary</strong>{!previewOnly && editingSummaryPath !== current?.path && <button type="button" disabled={busy || updating} onClick={() => { setSummaryDraft(summary); setEditingSummaryPath(current?.path ?? ""); }}>{summary ? "Edit summary" : "Add summary"}</button>}</div>{editingSummaryPath === current?.path ? <form onSubmit={event => { event.preventDefault(); void saveSummary(); }}><textarea autoFocus aria-label="Summary text" value={summaryDraft} onChange={event => setSummaryDraft(event.target.value)} maxLength={10000} disabled={busy || updating} placeholder="A short account of this link" /><div><button type="button" disabled={updating} onClick={() => setEditingSummaryPath("")}>Cancel</button><button type="submit" disabled={busy || updating || summaryDraft.trim() === summary}>{updating ? "Saving…" : "Save summary"}</button></div></form> : summary && <p>{summary}</p>}</section>}
      {document && <section className="vault-bookmark-note" aria-label="Personal note"><div><strong>My note</strong>{!noteIsEditing && !previewOnly && <button type="button" disabled={busy || updating} onClick={() => { setNoteDraft(personalNote); setEditingNotePath(current?.path ?? ""); }}>{personalNote ? "Edit note" : "Add note"}</button>}</div>{noteIsEditing ? <form onSubmit={event => { event.preventDefault(); void saveNote(); }}><textarea autoFocus aria-label="Personal note text" value={noteDraft} onChange={event => setNoteDraft(event.target.value)} maxLength={10000} disabled={busy || updating} placeholder="What do you want to remember?" /><div><button type="button" disabled={updating} onClick={() => setEditingNotePath("")}>Cancel</button><button type="submit" disabled={busy || updating || noteDraft.trim() === personalNote}>{updating ? "Saving…" : "Save note"}</button></div></form> : personalNote && <p>{personalNote}</p>}</section>}
      {document && customFields.length > 0 && <section className="vault-bookmark-custom-fields" aria-label="Bookmark details fields"><h2>Details</h2>{customFields.map(field => {
        const value = document.content.fields[field.id];
        const key = `${current.path}:${field.id}`;
        const editable = ["text", "richtext", "url", "date", "number", "boolean"].includes(field.type) || field.type === "enum" && !field.multiple;
        const display = value == null || value === "" ? "Not set" : typeof value === "boolean" ? value ? "Yes" : "No" : Array.isArray(value) ? value.every(entry => typeof entry === "string") ? value.join(", ") : `${value.length} entries` : typeof value === "object" ? "Open item to view" : field.type === "enum" ? field.options.find(option => option.value === value)?.label ?? String(value) : String(value);
        return <div className="vault-bookmark-custom-field" key={field.id}><div><strong>{field.label}</strong>{editable && editingField !== key && !previewOnly && <button type="button" disabled={busy || updating} aria-label={`Edit ${field.label}`} onClick={() => { setEditingField(key); setFieldDraft(value == null ? "" : String(value)); }}>Edit</button>}</div>{editingField === key ? <form onSubmit={event => { event.preventDefault(); void saveCustomField(field); }}>{field.type === "enum" ? <select aria-label={field.label} value={fieldDraft} onChange={event => setFieldDraft(event.target.value)} disabled={updating}><option value="">Not set</option>{field.options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select> : field.type === "boolean" ? <select aria-label={field.label} value={fieldDraft} onChange={event => setFieldDraft(event.target.value)} disabled={updating}><option value="false">No</option><option value="true">Yes</option></select> : field.type === "richtext" ? <textarea aria-label={field.label} value={fieldDraft} onChange={event => setFieldDraft(event.target.value)} disabled={updating} /> : <input aria-label={field.label} type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "url" ? "url" : "text"} value={fieldDraft} onChange={event => setFieldDraft(event.target.value)} disabled={updating} />}<div><button type="button" onClick={() => setEditingField("")} disabled={updating}>Cancel</button><button type="submit" disabled={updating}>Save</button></div></form> : <p>{display}</p>}</div>;
      })}</section>}
      </div></details></header>}
      {error && <p role="alert" className="vault-bookmark-error">{error}</p>}
      {document && (captureFailed || linkPlaceholder) && <div className="vault-bookmark-capture-status" role="status"><p>{captureFailed ? "The page could not be captured. Your link is still saved." : "The link is saved. A readable copy is being prepared."}</p></div>}
      {document && resumeProgress > 0 && <button type="button" className="vault-bookmark-resume" onClick={resumeReading}>Continue at {resumeProgress}%</button>}
      {document && template ? <ArticleReader key={current?.path} document={document} template={template} update={previewOnly || busy ? undefined : updateReader} flushUpdate={flushReaderDraft} compact /> : <p>{current ? "Reading saved page…" : "Save a link to start reading."}</p>}
    </article>
  </div>;
}
