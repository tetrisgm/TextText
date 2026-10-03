import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DocumentCollectionRenderer } from "@/components/document/DocumentRenderer";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { selectCollectionView } from "@/lib/presentation/collection-views";
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from "@/lib/presentation/templates";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { vaultRequest, type VaultListing } from "./bridge";
import { folderForItem } from "./folders";
import { collectionDocument, collectionMembers, noteCardDocument, queryFolderMembers, type FolderPreview } from "./folder-collection";
import { VaultFeedHeadlines } from "./VaultFeedHeadlines";
import { VaultBookmarkLibrary } from "./VaultBookmarkLibrary";
import { VaultGalleryLightbox } from "./VaultGalleryLightbox";

const PAGE_SIZE = 24;
const noteTemplate = BUILTIN_TEMPLATES.find(template => template.id === "texttext.note");
function noteCardTemplate(preview?: FolderPreview): TemplateDefinition | undefined {
  const reference = preview?.document?.presentation.template;
  if (!reference) return noteTemplate;
  if (preview?.templateJSON) {
    try {
      const template = validateTemplateDefinition(JSON.parse(preview.templateJSON));
      if (template.id === reference.id && template.version === reference.version) return template;
    } catch { /* A damaged saved look falls back to the standard card. */ }
  }
  return getBuiltinTemplate(reference.id, reference.version) ?? noteTemplate;
}
let queue: Promise<unknown> = Promise.resolve();
function requestPreview(path: string, active: () => boolean, metadataOnly = false): Promise<FolderPreview | null> {
  const request = queue.then(() => active() ? vaultRequest<FolderPreview>("preview", { path, metadataOnly }) : null);
  queue = request.catch(() => null);
  return request;
}
function PreviewImage({ preview, children }: { preview?: FolderPreview; children: (url?: string) => React.ReactNode }) {
  const [source, setSource] = useState<{ image: FolderPreview["image"]; url: string }>();
  const image = preview?.image;
  useEffect(() => {
    if (!image || !["image/png", "image/jpeg"].includes(image.contentType) || image.data.length > 700_000) return;
    let url: string;
    try {
      const bytes = Uint8Array.from(atob(image.data), (character) => character.charCodeAt(0));
      url = URL.createObjectURL(new Blob([bytes], { type: image.contentType }));
    } catch { return; }
    const handle = { image, url };
    void Promise.resolve().then(() => setSource(handle));
    return () => URL.revokeObjectURL(url);
  }, [image]);
  return children(source?.image === image ? source?.url : undefined);
}
function GalleryTile({ source, title, disabled, onOpen, onMeasured, width, height }: { source?: string; title: string; disabled: boolean; onOpen: () => void; onMeasured: (ratio: number) => void; width: number; height: number }) {
  return <button disabled={disabled} onClick={onOpen} aria-label={`Open ${title}`} style={{ width, height }}>
    {source ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={source} alt="" loading="lazy" decoding="async" onLoad={event => {
      const image = event.currentTarget;
      if (image.naturalWidth && image.naturalHeight) onMeasured(Math.max(0.4, Math.min(4, image.naturalWidth / image.naturalHeight)));
    }} /> : <span>{title}</span>}
  </button>;
}
export function VaultDocumentGrid({ listing, folder, busy, onOpen, onEditNote, onRevealBookmark, onCreateNote, onQuickSaveBookmark, folderTemplate, excludedPath, previewOnly = false, canUsePersonalBookmarks = true, emptyMessage, preferredBookmarkPath }: {
  listing: VaultListing; folder: string; busy: boolean; onOpen: (path: string) => void;
  onEditNote?: (path: string) => void;
  onRevealBookmark?: (path: string) => void;
  onCreateNote?: (pastedText?: string) => void; canUsePersonalBookmarks?: boolean;
  onQuickSaveBookmark?: (address: string) => Promise<void>;
  folderTemplate?: TemplateDefinition; excludedPath?: string; previewOnly?: boolean; emptyMessage?: string; preferredBookmarkPath?: string;
}) {
  const [page, setPage] = useState(0);
  const [view, setView] = useState("");
  const [galleryState, setGalleryState] = useState<{ entries: { path: string; index: number }[]; selection: number } | null>(null);
  const galleryGrid = useRef<HTMLDivElement>(null);
  const [galleryWidth, setGalleryWidth] = useState(0);
  const [galleryRatios, setGalleryRatios] = useState<Record<string, number>>({});
  useEffect(() => {
    if (folder !== "Gallery" || !galleryGrid.current) return;
    const observer = new ResizeObserver(entries => setGalleryWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(galleryGrid.current);
    return () => observer.disconnect();
  }, [folder]);
  const [gallerySearchOpen, setGallerySearchOpen] = useState(false);
  const [previews, setPreviews] = useState<Record<string, FolderPreview>>({});
  const [query, setQuery] = useState<{ key: string; listing?: VaultListing; previews: Record<string, FolderPreview>; done: boolean; error?: string }>({ key: "", previews: {}, done: false });
  const template = useMemo(() => folderTemplate ? { ...folderTemplate, collection: selectCollectionView(folderTemplate.collection, view || folderTemplate.collection.defaultView || "") } : undefined, [folderTemplate, view]);
  const members = useMemo(() => collectionMembers(listing.items, folder, Boolean(template), excludedPath), [listing, folder, template, excludedPath]);
  const unsupportedDates = Boolean(template?.collection.sort.some((entry) => ["createdAt", "updatedAt", "publishedAt"].includes(entry.field)));
  const needsQuery = Boolean(template && !unsupportedDates && (template.collection.sort.length || template.collection.filters.length));
  const queryKey = JSON.stringify([listing.root, folder, members.map((item) => item.path), template?.collection.sort, template?.collection.filters]);
  useEffect(() => {
    // Opening a file takes priority over collection previews. A queued preview
    // can otherwise read and decode a whole TextPack while the editor opens.
    if (busy || !needsQuery || members.length > 2048) return;
    let active = true;
    void Promise.resolve().then(async () => {
      const metadata: Record<string, FolderPreview> = {};
      let totalBytes = 0;
      for (const item of members) {
        if (!active) return;
        try {
          const preview = await requestPreview(item.path, () => active, true);
          if (preview) {
            totalBytes += new TextEncoder().encode(JSON.stringify(preview)).byteLength;
            if (totalBytes > 8 * 1024 * 1024) {
              if (active) setQuery({ key: queryKey, listing, previews: {}, done: true, error: "This folder exceeds the query limits. Showing all files without the requested sort or filters." });
              return;
            }
            const fields = Object.fromEntries(Object.entries(preview.document?.content.fields || {}).filter(([id]) =>
              template?.collection.sort.some((entry) => entry.field === `content.fields.${id}`) || template?.collection.filters.some((entry) => entry.field === `content.fields.${id}`)));
            metadata[item.path] = { title: preview.title, excerpt: "", metadataTruncated: preview.metadataTruncated, incompleteFields: preview.incompleteFields, document: preview.document ? { ...preview.document,
              content: { ...preview.document.content, body: "", tags: [], assets: [], fields } } : undefined };
          }
        } catch { /* Query validation exposes incomplete details instead of silently excluding files. */ }
      }
      if (active) setQuery({ key: queryKey, listing, previews: metadata, done: true });
    });
    return () => { active = false; };
  }, [busy, needsQuery, queryKey, members, template, listing]);
  let queryMessage = unsupportedDates ? "Date sorting is not available for this folder yet. Showing all files in their existing order." : "";
  let items = members;
  if (needsQuery && template) {
    if (members.length > 2048) queryMessage = "Folder sorting and filtering supports up to 2,048 files here. Showing all files in their existing order.";
    else if (query.key !== queryKey || query.listing !== listing || !query.done) queryMessage = "Reading folder details before applying its sort and filters…";
    else if (query.error) queryMessage = query.error;
    else try { items = queryFolderMembers(members, query.previews, template.collection); }
    catch (error) { queryMessage = error instanceof Error ? error.message : "Folder details are unavailable."; }
  }
  const fallbackTitle = (item: VaultListing["items"][number]) => item.title || item.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Untitled";
  const galleryFolder = folder === "Gallery";
  const [gallerySearch, setGallerySearch] = useState("");
  const [galleryTag, setGalleryTag] = useState("");
  const collectionSearchKey = (galleryFolder || folder === "Blog") ? JSON.stringify([listing.root, items.map(item => item.path)]) : "";
  const [collectionSearchIndex, setCollectionSearchIndex] = useState<{ key: string; listing?: VaultListing; previews: Record<string, FolderPreview>; error: string }>({ key: "", previews: {}, error: "" });
  useEffect(() => {
    if (!collectionSearchKey || busy || collectionSearchIndex.key === collectionSearchKey && collectionSearchIndex.listing === listing) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (items.length > 2048) { if (active) setCollectionSearchIndex({ key: collectionSearchKey, listing, previews: {}, error: "Search supports up to 2,048 items in one folder." }); return; }
      const found: Record<string, FolderPreview> = {};
      let totalBytes = 0;
      for (const item of items) {
        if (!active) return;
        try {
          const preview = await requestPreview(item.path, () => active, true);
          if (!preview?.document || preview.incompleteFields?.some(field => ["*", "title", "subtitle", "tags", "content.fields.sourceUrl"].includes(field))) {
            if (active) setCollectionSearchIndex({ key: collectionSearchKey, listing, previews: {}, error: "Search is unavailable because some item details could not be read." });
            return;
          }
          const compact: FolderPreview = { title: preview.title, excerpt: preview.excerpt, sourceURL: preview.sourceURL, publishedAt: preview.publishedAt, document: { ...preview.document,
            content: { ...preview.document.content, body: "", fields: {}, assets: [] } } };
          totalBytes += new TextEncoder().encode(JSON.stringify(compact)).byteLength;
          if (totalBytes > 8 * 1024 * 1024) { if (active) setCollectionSearchIndex({ key: collectionSearchKey, listing, previews: {}, error: "Item details exceed the 8 MiB search limit." }); return; }
          found[item.path] = compact;
        } catch { if (active) setCollectionSearchIndex({ key: collectionSearchKey, listing, previews: {}, error: "Search is unavailable while an item cannot be read." }); return; }
      }
      if (active) setCollectionSearchIndex({ key: collectionSearchKey, listing, previews: found, error: "" });
    });
    return () => { active = false; };
    // The key captures the folder listing without restarting the metadata scan on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, collectionSearchKey, listing]);
  const collectionSearchReady = (galleryFolder || folder === "Blog") && collectionSearchIndex.key === collectionSearchKey && collectionSearchIndex.listing === listing && !collectionSearchIndex.error;
  const galleryQuery = gallerySearch.trim().toLocaleLowerCase();
  const galleryTags = galleryFolder && collectionSearchReady ? [...new Set(items.flatMap(item => collectionSearchIndex.previews[item.path]?.document?.content.tags ?? []))].sort((left, right) => left.localeCompare(right)) : [];
  const [storySearch, setStorySearch] = useState("");
  const [storyStatus, setStoryStatus] = useState<"all" | "drafts" | "published">("all");
  const storyQuery = storySearch.trim().toLocaleLowerCase();
  const notesFolder = folder === "Notes";
  const [noteSearch, setNoteSearch] = useState("");
  const [noteContentSearch, setNoteContentSearch] = useState<{ query: string; listing?: VaultListing; paths: Set<string>; truncated: boolean; error: string }>({ query: "", paths: new Set(), truncated: false, error: "" });
  const [noteTag, setNoteTag] = useState("");
  const [noteSort, setNoteSort] = useState<"folder" | "title">("folder");
  const noteIndexKey = notesFolder ? JSON.stringify([listing.root, items.map(item => item.path)]) : "";
  const [noteIndex, setNoteIndex] = useState<{ key: string; listing?: VaultListing; previews: Record<string, FolderPreview>; error: string }>({ key: "", previews: {}, error: "" });
  useEffect(() => {
    if (!noteIndexKey || busy || noteIndex.key === noteIndexKey && noteIndex.listing === listing) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (items.length > 2048) { if (active) setNoteIndex({ key: noteIndexKey, listing, previews: {}, error: "Search supports up to 2,048 cards in one folder." }); return; }
      const found: Record<string, FolderPreview> = {};
      let totalBytes = 0;
      for (const item of items) {
        if (!active) return;
        try {
          const preview = await requestPreview(item.path, () => active, true);
          if (!preview?.document || preview.incompleteFields?.some(field => ["*", "title", "tags"].includes(field))) {
            if (active) setNoteIndex({ key: noteIndexKey, listing, previews: {}, error: "Card search is unavailable because some card details could not be read." });
            return;
          }
          const compact: FolderPreview = { title: preview.title, excerpt: preview.excerpt, document: { ...preview.document,
            content: { ...preview.document.content, body: preview.excerpt, fields: {}, assets: [] } } };
          totalBytes += new TextEncoder().encode(JSON.stringify(compact)).byteLength;
          if (totalBytes > 8 * 1024 * 1024) { if (active) setNoteIndex({ key: noteIndexKey, listing, previews: {}, error: "Card details exceed the 8 MiB search limit." }); return; }
          found[item.path] = compact;
        } catch { if (active) setNoteIndex({ key: noteIndexKey, listing, previews: {}, error: "Card search is unavailable while a card cannot be read." }); return; }
      }
      if (active) setNoteIndex({ key: noteIndexKey, listing, previews: found, error: "" });
    });
    return () => { active = false; };
    // The key captures the folder listing and order without restarting an in-flight scan on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, noteIndexKey, listing]);
  const noteIndexReady = notesFolder && noteIndex.key === noteIndexKey && noteIndex.listing === listing && !noteIndex.error;
  const noteTags = noteIndexReady ? [...new Set(items.flatMap(item => noteIndex.previews[item.path]?.document?.content.tags ?? []))].sort((left, right) => left.localeCompare(right)) : [];
  const noteQuery = noteSearch.trim().toLocaleLowerCase();
  useEffect(() => {
    if (!notesFolder || !noteQuery || !noteIndexReady) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void vaultRequest<{ items: { path: string }[]; truncated?: boolean; skippedCount?: number }>("search", { query: noteQuery, folder: "Notes" }, controller.signal)
        .then(result => { if (!controller.signal.aborted) setNoteContentSearch({ query: noteQuery, listing, paths: new Set(result.items.map(item => item.path)), truncated: Boolean(result.truncated || result.skippedCount), error: "" }); })
        .catch(reason => { if (!controller.signal.aborted) setNoteContentSearch({ query: noteQuery, listing, paths: new Set(), truncated: false, error: reason instanceof Error ? reason.message : "Card search could not finish." }); });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [notesFolder, noteQuery, noteIndexReady, listing]);
  const indexedNoteTitle = (item: VaultListing["items"][number]) => noteIndex.previews[item.path]?.title?.trim() || fallbackTitle(item);
  const searchMatchedItems = noteIndexReady && notesFolder ? items.filter(item => {
    const preview = noteIndex.previews[item.path];
    const tags = preview?.document?.content.tags ?? [];
    return (!noteTag || tags.includes(noteTag)) && (!noteQuery || `${indexedNoteTitle(item)} ${preview?.excerpt ?? ""} ${tags.join(" ")}`.toLocaleLowerCase().includes(noteQuery) || noteContentSearch.query === noteQuery && noteContentSearch.listing === listing && noteContentSearch.paths.has(item.path));
  }).sort((left, right) => noteSort === "title" ? indexedNoteTitle(left).localeCompare(indexedNoteTitle(right)) : 0) : collectionSearchReady && (galleryFolder ? galleryQuery || galleryTag : storyQuery) ? items.filter(item => {
    const preview = collectionSearchIndex.previews[item.path];
    return (!galleryFolder || !galleryTag || preview?.document?.content.tags.includes(galleryTag)) && `${preview?.title || fallbackTitle(item)} ${preview?.document?.content.subtitle || ""} ${preview?.excerpt || ""} ${preview?.sourceURL || ""} ${(preview?.document?.content.tags || []).join(" ")}`.toLocaleLowerCase().includes(galleryFolder ? galleryQuery : storyQuery);
  }) : items;
  const displayedItems = folder === "Blog" && collectionSearchReady && storyStatus !== "all"
    ? searchMatchedItems.filter(item => storyStatus === "published" ? Boolean(collectionSearchIndex.previews[item.path]?.publishedAt) : !collectionSearchIndex.previews[item.path]?.publishedAt)
    : searchMatchedItems;
  const feedIndexKey = folder === "Feeds" ? JSON.stringify([listing.root, items.map(item => item.path)]) : "";
  const [feedIndex, setFeedIndex] = useState<{ key: string; previews: Record<string, FolderPreview>; done: boolean; error: string }>({ key: "", previews: {}, done: false, error: "" });
  useEffect(() => {
    if (!feedIndexKey || busy) return;
    let active = true;
    void Promise.resolve().then(async () => {
      const metadata: Record<string, FolderPreview> = {};
      let totalBytes = 0;
      if (items.length > 2048) { setFeedIndex({ key: feedIndexKey, previews: {}, done: true, error: "Feeds supports up to 2,048 subscriptions in one folder." }); return; }
      for (const item of items) {
        if (!active) return;
        try {
          const preview = await requestPreview(item.path, () => active, true);
          if (!preview?.document) continue;
          const compact: FolderPreview = { title: preview.title, excerpt: "", document: { ...preview.document,
            content: { ...preview.document.content, body: "", assets: [] } } };
          totalBytes += new TextEncoder().encode(JSON.stringify(compact)).byteLength;
          if (totalBytes > 8 * 1024 * 1024) { setFeedIndex({ key: feedIndexKey, previews: {}, done: true, error: "Feed subscription details exceed the 8 MiB folder limit." }); return; }
          metadata[item.path] = compact;
        } catch { /* A damaged subscription stays visible in Sources without blocking the others. */ }
      }
      if (active) setFeedIndex({ key: feedIndexKey, previews: metadata, done: true, error: "" });
    });
    return () => { active = false; };
  }, [busy, feedIndexKey, items]);
  const lastPage = Math.max(0, Math.ceil(displayedItems.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = useMemo(() => displayedItems.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), [displayedItems, currentPage]);
  const visibleKey = JSON.stringify([listing, visible.map((item) => item.path)]);
  useEffect(() => {
    if (busy || folder === "Feeds") return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setPreviews({});
      for (const item of visible) {
        if (!active) return;
        try {
          let preview = await requestPreview(item.path, () => active);
          const reference = preview?.document?.presentation.template;
          if (active && preview && folder === "Notes" && reference && !getBuiltinTemplate(reference.id, reference.version)) {
            try {
              const source = await vaultRequest<{ templateJSON?: string }>("template", { path: item.path });
              if (source.templateJSON?.length && source.templateJSON.length <= 256 * 1024) {
                const candidate = validateTemplateDefinition(JSON.parse(source.templateJSON));
                if (candidate.id === reference.id && candidate.version === reference.version) preview = { ...preview, templateJSON: source.templateJSON };
              }
            } catch { /* Keep the card readable with the standard look. */ }
          }
          if (active && preview) setPreviews((previous) => ({ ...previous, [item.path]: preview }));
        } catch { /* The original stays accessible when its preview cannot be read. */ }
      }
    });
    return () => { active = false; };
    // Key tracks the listing revision and visible paths; query results create fresh arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, visibleKey, folder]);
  const requestedLayout = template?.collection.layout || "cards";
  const supported = ["cards", "list", "index"].includes(requestedLayout);
  const layout = supported ? requestedLayout : "list";
  const photoFolder = folder === "Gallery";
  const bookmarkFolder = folder === "Bookmarks";
  const blogFolder = folder === "Blog";
  const feedsFolder = folder === "Feeds";
  const referenceFolder = photoFolder || bookmarkFolder || notesFolder || blogFolder || feedsFolder;
  const galleryEntries = photoFolder ? visible.flatMap(item => {
    const count = previews[item.path]?.images?.length || 1;
    return Array.from({ length: count }, (_, index) => ({ path: item.path, index }));
  }) : [];
  const galleryTiles = photoFolder ? visible.flatMap(item => {
    const preview = previews[item.path];
    const images = preview?.images?.length ? preview.images : [preview?.image];
    return images.map((image, index) => ({ item, preview, image, index, key: `${item.path}:${index}`, title: `${preview?.title || fallbackTitle(item)}${images.length > 1 ? ` image ${index + 1}` : ""}` }));
  }) : [];
  const galleryRows: { tiles: typeof galleryTiles; height: number; widths: number[] }[] = [];
  const rowGap = 12;
  let pending: typeof galleryTiles = [];
  let ratioSum = 0;
  const finishRow = (last: boolean) => {
    if (!pending.length) return;
    const available = Math.max(0, galleryWidth - rowGap * (pending.length - 1));
    const height = !galleryWidth ? 180 : last ? Math.min(180, available / ratioSum) : available / ratioSum;
    galleryRows.push({ tiles: pending, height, widths: pending.map(tile => height * (galleryRatios[tile.key] ?? 1)) });
    pending = []; ratioSum = 0;
  };
  for (const tile of galleryTiles) {
    pending.push(tile); ratioSum += galleryRatios[tile.key] ?? 1;
    if (galleryWidth && ratioSum * 180 + rowGap * (pending.length - 1) >= galleryWidth) finishRow(false);
  }
  finishRow(true);
  const filePages = lastPage > 0 && !bookmarkFolder ? <nav className="vault-file-pages" aria-label="File pages"><button disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {lastPage + 1}</span><button disabled={busy || currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></nav> : null;
  return <section aria-label="Documents" className={referenceFolder ? `vault-${folder.toLowerCase()}-folder` : undefined} onPaste={event => {
    if (!notesFolder || !onCreateNote || busy || previewOnly) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable], [role="textbox"]')) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text.trim()) return;
    event.preventDefault();
    onCreateNote(text);
  }}>{!referenceFolder && <h3>{folder ? "Files" : "Explore your documents"}</h3>}
    {template && !referenceFolder && template.collection.views.length > 0 && <label>Folder view <select aria-label="Folder view" value={view || template.collection.defaultView || ""} onChange={(event) => { setView(event.target.value); setPage(0); }}><option value="">Default</option>{template.collection.views.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
    {!supported && <p role="status">The {requestedLayout} layout is not available here yet. Showing a readable list.</p>}
    {queryMessage && <p role="status">{queryMessage}</p>}
    {folder === "Feeds" && feedIndex.key === feedIndexKey && feedIndex.error && <p role="alert">{feedIndex.error}</p>}
    {photoFolder ? <><div className="vault-gallery-tools">{galleryTags.length > 0 && <select aria-label="Filter image tags" value={galleryTag} onChange={event => { setGalleryTag(event.target.value); setPage(0); }}><option value="">All images</option>{galleryTags.map(tag => <option key={tag} value={tag}>#{tag}</option>)}</select>}{gallerySearchOpen ? <label className="vault-gallery-search"><span className="ac-sr-only">Find images</span><input autoFocus type="search" aria-label="Find images" value={gallerySearch} onChange={event => { setGallerySearch(event.target.value); setPage(0); }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setGallerySearch(""); setGallerySearchOpen(false); setPage(0); } }} disabled={!collectionSearchReady} placeholder={collectionSearchReady ? "Find images" : "Reading image details…"} /></label> : <button type="button" className="vault-gallery-search-button" aria-label="Search images" title="Search images" onClick={() => setGallerySearchOpen(true)}><svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m12.5 12.5 4.5 4.5"/></svg></button>}{gallerySearchOpen && <button type="button" className="vault-gallery-search-close" aria-label="Close image search" onClick={() => { setGallerySearch(""); setGallerySearchOpen(false); setPage(0); }}>Done</button>}</div>{collectionSearchIndex.key === collectionSearchKey && collectionSearchIndex.error && <p role="status">{collectionSearchIndex.error}</p>}{collectionSearchReady && (galleryQuery || galleryTag) && !displayedItems.length && <p role="status">No images match.</p>}<div className="vault-photo-grid" ref={galleryGrid}>{galleryRows.map((row, rowIndex) => <div className="vault-photo-row" key={`${rowIndex}:${row.tiles[0].key}`}>{row.tiles.map((tile, index) => <PreviewImage key={tile.key} preview={tile.preview ? { ...tile.preview, image: tile.image } : undefined}>{source => <GalleryTile source={source} title={tile.title} disabled={busy || previewOnly} width={row.widths[index]} height={row.height} onMeasured={ratio => setGalleryRatios(current => current[tile.key] === ratio ? current : { ...current, [tile.key]: ratio })} onOpen={() => setGalleryState({ entries: galleryEntries, selection: galleryEntries.findIndex(entry => entry.path === tile.item.path && entry.index === tile.index) })} />}</PreviewImage>)}</div>)}</div></> : bookmarkFolder ? <VaultBookmarkLibrary items={items} previews={previews} busy={busy} previewOnly={previewOnly} onOpen={onOpen} onQuickSave={onQuickSaveBookmark} preferredPath={preferredBookmarkPath} /> : notesFolder ? <>
      {onCreateNote && !previewOnly && <button className="vault-note-start" aria-label="Start typing Make a new card" disabled={busy} onClick={() => onCreateNote()}>Start typing or paste to make a card</button>}
      <div className="vault-note-tools"><label><span className="ac-sr-only">Find cards</span><input type="search" aria-label="Find cards" value={noteSearch} onChange={event => { setNoteSearch(event.target.value); setPage(0); }} disabled={!noteIndexReady} placeholder={noteIndexReady ? "Find cards" : "Reading cards…"} /></label><label><span className="ac-sr-only">Sort cards</span><select aria-label="Sort cards" value={noteSort} onChange={event => { setNoteSort(event.target.value as "folder" | "title"); setPage(0); }} disabled={!noteIndexReady}><option value="folder">Folder order</option><option value="title">Title A–Z</option></select></label></div>
      {noteIndex.key === noteIndexKey && noteIndex.listing === listing && noteIndex.error && <p role="status" className="vault-note-index-status">{noteIndex.error}</p>}
      {noteQuery && noteContentSearch.query === noteQuery && noteContentSearch.listing === listing && (noteContentSearch.error || noteContentSearch.truncated) && <p role="status" className="vault-note-index-status">{noteContentSearch.error || "Some long cards were not searched. Results may be incomplete."}</p>}
      {noteTags.length > 0 && <div className="vault-note-tag-filters" role="group" aria-label="Filter card tags"><button aria-pressed={!noteTag} onClick={() => { setNoteTag(""); setPage(0); }}>All</button>{noteTags.slice(0, 50).map(tag => <button key={tag} aria-pressed={noteTag === tag} onClick={() => { setNoteTag(tag); setPage(0); }}>#{tag}</button>)}{noteTags.length > 50 && <span>Find more tags with search</span>}</div>}
      {noteIndexReady && displayedItems.length === 0 && <p className="vault-note-index-status">No cards match.</p>}
      <div className="vault-note-cards">{visible.map(item => { const preview = previews[item.path]; const title = preview?.title || fallbackTitle(item); const look = noteCardTemplate(preview); return <div className="vault-note-card" key={item.path} onClick={event => {
        if (busy || previewOnly || event.target instanceof Element && event.target.closest("a, button, input, textarea, select") || window.getSelection()?.toString().trim()) return;
        onOpen(item.path);
      }}>{look ? <DocumentCollectionRenderer document={noteCardDocument(preview, title)} template={look} documentId={`note-${item.path}`} /> : <strong>{title}</strong>}{preview?.document?.content.tags.length ? <div className="vault-note-card-tags">{preview.document.content.tags.slice(0, 3).map(tag => <button key={tag} type="button" disabled={busy || previewOnly} onClick={() => { setNoteTag(tag); setPage(0); }} aria-label={`Filter cards by ${tag}`}>#{tag}</button>)}</div> : null}<button className="vault-note-open" disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={`Open ${title}`} title="Open card"><span aria-hidden="true">↗</span></button>{onEditNote && !previewOnly && <button className="vault-note-card-edit" disabled={busy} onClick={() => onEditNote(item.path)} aria-label={`Edit ${title}`} title="Edit card"><svg aria-hidden="true" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m4 13 8.9-8.9a2 2 0 0 1 2.8 2.8L6.8 15.8 3 17z"/><path d="m11.4 5.6 3 3"/></svg></button>}</div>; })}</div>
    </> : blogFolder ? <><div className="vault-story-tools"><div className="vault-story-status" role="group" aria-label="Story status">{(["all", "drafts", "published"] as const).map(status => <button key={status} type="button" aria-pressed={storyStatus === status} disabled={!collectionSearchReady} onClick={() => { setStoryStatus(status); setPage(0); }}>{status === "all" ? "All stories" : status === "drafts" ? "Drafts" : "Published"}</button>)}</div><label className="vault-story-search"><span className="ac-sr-only">Find stories</span><input type="search" aria-label="Find stories" value={storySearch} onChange={event => { setStorySearch(event.target.value); setPage(0); }} disabled={!collectionSearchReady} placeholder={collectionSearchReady ? "Find stories" : "Reading story details…"} /></label></div>{collectionSearchIndex.key === collectionSearchKey && collectionSearchIndex.error && <p role="status">{collectionSearchIndex.error}</p>}{collectionSearchReady && (storyQuery || storyStatus !== "all") && !displayedItems.length && <p role="status">No {storyStatus === "all" ? "stories" : storyStatus === "drafts" ? "drafts" : "published stories"} match.</p>}<div className="vault-story-list">{visible.map(item => {
      const preview = previews[item.path] || collectionSearchIndex.previews[item.path];
      const title = preview?.document && !preview.document.content.title.trim() ? "New story" : preview?.title || fallbackTitle(item);
      const authorValue = preview?.document?.content.fields.author;
      const author = typeof authorValue === "string" ? authorValue.trim() : "";
      const subtitle = preview?.document?.content.subtitle?.trim() || "";
      const excerpt = preview?.excerpt && preview.excerpt !== subtitle ? preview.excerpt : "";
      return <PreviewImage key={item.path} preview={preview}>{source => <button disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={"Open " + title}>
        <span className="vault-story-copy">
          <small className="vault-story-list-byline">{author && <span className="vault-story-list-avatar" aria-hidden="true">{author.slice(0, 1).toUpperCase()}</span>}{author || "Story"}{preview && <span className="vault-story-list-status">· {preview.publishedAt ? "Published" : "Draft"}</span>}</small>
          <strong>{title}</strong>
          {subtitle && <span className="vault-story-list-subtitle">{subtitle}</span>}
          {excerpt && <span className="vault-story-list-excerpt">{excerpt}</span>}
        </span>
        {source && /* eslint-disable-next-line @next/next/no-img-element */ <img src={source} alt="" loading="lazy" />}
      </button>}</PreviewImage>;
    })}</div></> : feedsFolder ? <VaultFeedHeadlines sources={items.map(item => feedIndex.previews[item.path]).filter((entry): entry is FolderPreview => Boolean(entry))} ready={feedIndex.key === feedIndexKey && feedIndex.done && !feedIndex.error} canAdd={!busy && !previewOnly && canUsePersonalBookmarks} canReadLater={canUsePersonalBookmarks && !previewOnly} canOpenBookmark={!busy && !previewOnly && canUsePersonalBookmarks} onOpenBookmark={onRevealBookmark ?? onOpen} sourceList={<><div className="vault-feed-sources">{visible.map(item => { const preview = feedIndex.previews[item.path]; return <button key={item.path} disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={`Open ${preview?.title || fallbackTitle(item)}`}><span className="vault-feed-source-icon" aria-hidden="true">◉</span><span><strong>{preview?.title || fallbackTitle(item)}</strong><small>{typeof preview?.document?.content.fields.feedUrl === "string" ? preview.document.content.fields.feedUrl : "Open latest stories"}</small></span><span aria-hidden="true">›</span></button>; })}</div>{filePages}</>} /> : template && layout === "index" ? <div className="vault-folder-table-wrapper"><table className="vault-folder-table"><thead><tr><th>Title</th><th>Source</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map((item) => {
      const preview = previews[item.path];
      return <tr key={item.path}><td>{preview?.title || fallbackTitle(item)}</td><td>{preview?.sourceURL || ""}</td><td>{preview?.document?.content.tags.join(", ") || ""}</td><td><button disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={`Open ${preview?.title || fallbackTitle(item)}`}>Open</button></td></tr>;
    })}</tbody></table></div> : <div className={template ? "vault-folder-collection" : "vault-document-grid"} data-layout={layout} style={template ? { "--vault-folder-columns": template.collection.columns, "--vault-folder-gap": template.collection.gap === "none" ? "0" : ({ xs: "0.25rem", sm: "0.5rem", md: "1rem", lg: "1.5rem", xl: "2rem" } as Record<string, string>)[template.collection.gap] || "1rem" } as CSSProperties : undefined}>{visible.map((item) => {
      const preview = previews[item.path];
      const fallback = fallbackTitle(item);
      return <PreviewImage key={item.path} preview={preview}>{(source) => template ? <div className="vault-folder-item">
        <DocumentCollectionRenderer document={collectionDocument(preview, fallback, source)} template={template} documentId={`folder-${item.path}`} />
        <button disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={`Open ${preview?.title || fallback}`}>Open</button>
      </div> : <button disabled={busy || previewOnly} aria-label={`${fallback} ${folderForItem(item.path) || "Workspace"} Open →`} onClick={() => onOpen(item.path)}>
        {source ? /* eslint-disable-next-line @next/next/no-img-element */
          <img className="vault-file-preview" src={source} alt="" loading="lazy" decoding="async" />
          : <p className="vault-file-excerpt">{preview?.excerpt || "Open this file to start reading or editing."}</p>}
        <strong>{preview?.title || fallback}</strong><small>{folderForItem(item.path) || "Workspace"}</small>
        {preview?.sourceURL && <small className="vault-file-source">{preview.sourceURL}</small>}<span>Open →</span>
      </button>}</PreviewImage>;
    })}</div>}
    {!items.length && !feedsFolder && <p>{members.length ? "No files match this view." : emptyMessage ?? "No files here yet. Choose a template to get started."}</p>}
    {galleryState && <VaultGalleryLightbox entries={galleryState.entries} initialSelection={galleryState.selection} onClose={() => setGalleryState(null)} onEdit={path => { setGalleryState(null); onOpen(path); }} />}
    {!feedsFolder && filePages}
  </section>;
}
