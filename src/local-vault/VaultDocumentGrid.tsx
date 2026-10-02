import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DocumentCollectionRenderer } from "@/components/document/DocumentRenderer";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { selectCollectionView } from "@/lib/presentation/collection-views";
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from "@/lib/presentation/templates";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { vaultRequest, type VaultListing } from "./bridge";
import { folderForItem } from "./folders";
import { collectionDocument, collectionMembers, queryFolderMembers, type FolderPreview } from "./folder-collection";
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
function GalleryTile({ source, title, disabled, onOpen, width, height, onAspect }: { source?: string; title: string; disabled: boolean; onOpen: () => void; width: number; height: number; onAspect: (aspect: number) => void }) {
  return <button disabled={disabled} onClick={onOpen} aria-label={`Open ${title}`} style={{ width, height }}>
    {source ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={source} alt="" loading="lazy" decoding="async" onLoad={event => { const image = event.currentTarget; if (image.naturalHeight) onAspect(image.naturalWidth / image.naturalHeight); }} /> : <span>{title}</span>}
  </button>;
}
export function justifiedRows(aspects: number[], availableWidth: number, targetHeight = 210, gap = 8): { width: number; height: number }[][] {
  const rows: { width: number; height: number }[][] = [];
  const width = Math.max(240, availableWidth);
  for (let start = 0; start < aspects.length;) {
    let end = start;
    let sum = 0;
    while (end < aspects.length) {
      sum += Math.max(.25, Math.min(5, aspects[end] || 1));
      end++;
      if (sum * targetHeight + (end - start - 1) * gap >= width) break;
    }
    const fillsRow = sum * targetHeight + (end - start - 1) * gap >= width;
    const height = fillsRow ? Math.min(300, (width - (end - start - 1) * gap) / sum) : targetHeight;
    rows.push(aspects.slice(start, end).map(aspect => ({ width: Math.max(.25, Math.min(5, aspect || 1)) * height, height })));
    start = end;
  }
  return rows;
}
export function VaultDocumentGrid({ listing, folder, busy, onOpen, onRevealBookmark, onCreateNote, folderTemplate, excludedPath, previewOnly = false, canUsePersonalBookmarks = true, emptyMessage, preferredBookmarkPath }: {
  listing: VaultListing; folder: string; busy: boolean; onOpen: (path: string) => void;
  onRevealBookmark?: (path: string) => void;
  onCreateNote?: () => void; canUsePersonalBookmarks?: boolean;
  folderTemplate?: TemplateDefinition; excludedPath?: string; previewOnly?: boolean; emptyMessage?: string; preferredBookmarkPath?: string;
}) {
  const [page, setPage] = useState(0);
  const [view, setView] = useState("");
  const [galleryState, setGalleryState] = useState<{ entries: { path: string; index: number }[]; selection: number } | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const [galleryWidth, setGalleryWidth] = useState(900);
  const [galleryAspects, setGalleryAspects] = useState<Record<string, number>>({});
  useEffect(() => {
    const element = galleryRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setGalleryWidth(entries[0]?.contentRect.width || 900));
    observer.observe(element);
    return () => observer.disconnect();
  }, [folder]);
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
  const notesFolder = folder === "Notes";
  const [noteSearch, setNoteSearch] = useState("");
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
  const indexedNoteTitle = (item: VaultListing["items"][number]) => noteIndex.previews[item.path]?.title?.trim() || fallbackTitle(item);
  const displayedItems = noteIndexReady && notesFolder ? items.filter(item => {
    const preview = noteIndex.previews[item.path];
    const tags = preview?.document?.content.tags ?? [];
    return (!noteTag || tags.includes(noteTag)) && (!noteQuery || `${indexedNoteTitle(item)} ${preview?.excerpt ?? ""} ${tags.join(" ")}`.toLocaleLowerCase().includes(noteQuery));
  }).sort((left, right) => noteSort === "title" ? indexedNoteTitle(left).localeCompare(indexedNoteTitle(right)) : 0) : items;
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
  const galleryRows = justifiedRows(galleryTiles.map(tile => galleryAspects[tile.key] || 1), galleryWidth);
  let galleryTile = 0;
  const filePages = lastPage > 0 && !bookmarkFolder ? <nav className="vault-file-pages" aria-label="File pages"><button disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {lastPage + 1}</span><button disabled={busy || currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></nav> : null;
  return <section aria-label="Documents" className={referenceFolder ? `vault-${folder.toLowerCase()}-folder` : undefined}>{!referenceFolder && <h3>{folder ? "Files" : "Explore your documents"}</h3>}
    {template && !referenceFolder && template.collection.views.length > 0 && <label>Folder view <select aria-label="Folder view" value={view || template.collection.defaultView || ""} onChange={(event) => { setView(event.target.value); setPage(0); }}><option value="">Default</option>{template.collection.views.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
    {!supported && <p role="status">The {requestedLayout} layout is not available here yet. Showing a readable list.</p>}
    {queryMessage && <p role="status">{queryMessage}</p>}
    {folder === "Feeds" && feedIndex.key === feedIndexKey && feedIndex.error && <p role="alert">{feedIndex.error}</p>}
    {photoFolder ? <div className="vault-photo-grid" ref={galleryRef}>{galleryRows.map((row, rowIndex) => <div className="vault-photo-row" key={galleryTiles[galleryTile]?.key || rowIndex}>{row.map(size => { const tile = galleryTiles[galleryTile]; const selection = galleryTile++; return <PreviewImage key={tile.key} preview={tile.preview ? { ...tile.preview, image: tile.image } : undefined}>{source => <GalleryTile source={source} title={tile.title} disabled={busy || previewOnly} onOpen={() => setGalleryState({ entries: galleryEntries, selection })} width={size.width} height={size.height} onAspect={aspect => setGalleryAspects(previous => previous[tile.key] === aspect ? previous : { ...previous, [tile.key]: aspect })} />}</PreviewImage>; })}</div>)}</div> : bookmarkFolder ? <VaultBookmarkLibrary items={items} previews={previews} busy={busy} previewOnly={previewOnly} onOpen={onOpen} preferredPath={preferredBookmarkPath} /> : notesFolder ? <>
      {onCreateNote && !previewOnly && <button className="vault-note-start" aria-label="Start typing Make a new card" disabled={busy} onClick={onCreateNote}>Start typing or paste to make a card</button>}
      <div className="vault-note-tools"><label><span className="ac-sr-only">Find cards</span><input type="search" aria-label="Find cards" value={noteSearch} onChange={event => { setNoteSearch(event.target.value); setPage(0); }} disabled={!noteIndexReady} placeholder={noteIndexReady ? "Find cards" : "Reading cards…"} /></label><label><span className="ac-sr-only">Sort cards</span><select aria-label="Sort cards" value={noteSort} onChange={event => { setNoteSort(event.target.value as "folder" | "title"); setPage(0); }} disabled={!noteIndexReady}><option value="folder">Folder order</option><option value="title">Title A–Z</option></select></label></div>
      {noteIndex.key === noteIndexKey && noteIndex.listing === listing && noteIndex.error && <p role="status" className="vault-note-index-status">{noteIndex.error}</p>}
      {noteTags.length > 0 && <div className="vault-note-tag-filters" role="group" aria-label="Filter card tags"><button aria-pressed={!noteTag} onClick={() => { setNoteTag(""); setPage(0); }}>All</button>{noteTags.slice(0, 50).map(tag => <button key={tag} aria-pressed={noteTag === tag} onClick={() => { setNoteTag(tag); setPage(0); }}>#{tag}</button>)}{noteTags.length > 50 && <span>Find more tags with search</span>}</div>}
      {noteIndexReady && displayedItems.length === 0 && <p className="vault-note-index-status">No cards match.</p>}
      <div className="vault-note-cards">{visible.map(item => { const preview = previews[item.path]; const title = preview?.title || fallbackTitle(item); const look = noteCardTemplate(preview); return <div className="vault-note-card" key={item.path}>{look ? <DocumentCollectionRenderer document={collectionDocument(preview, title)} template={look} documentId={`note-${item.path}`} /> : <strong>{title}</strong>}{preview?.document?.content.tags.length ? <small>{preview.document.content.tags.slice(0, 3).map(tag => `#${tag}`).join("  ")}</small> : null}<button disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={`Open ${title}`} /></div>; })}</div>
    </> : blogFolder ? <div className="vault-story-list">{visible.map(item => {
      const preview = previews[item.path];
      const title = preview?.document && !preview.document.content.title.trim() ? "New story" : preview?.title || fallbackTitle(item);
      const authorValue = preview?.document?.content.fields.author;
      const author = typeof authorValue === "string" ? authorValue.trim() : "";
      const subtitle = preview?.document?.content.subtitle?.trim() || "";
      const excerpt = preview?.excerpt && preview.excerpt !== subtitle ? preview.excerpt : "";
      return <PreviewImage key={item.path} preview={preview}>{source => <button disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={"Open " + title}>
        <span className="vault-story-copy">
          <small className="vault-story-list-byline">{author && <span className="vault-story-list-avatar" aria-hidden="true">{author.slice(0, 1).toUpperCase()}</span>}{author || "Story"}</small>
          <strong>{title}</strong>
          {subtitle && <span className="vault-story-list-subtitle">{subtitle}</span>}
          {excerpt && <span className="vault-story-list-excerpt">{excerpt}</span>}
        </span>
        {source && /* eslint-disable-next-line @next/next/no-img-element */ <img src={source} alt="" loading="lazy" />}
      </button>}</PreviewImage>;
    })}</div> : feedsFolder ? <VaultFeedHeadlines sources={items.map(item => feedIndex.previews[item.path]).filter((entry): entry is FolderPreview => Boolean(entry))} ready={feedIndex.key === feedIndexKey && feedIndex.done && !feedIndex.error} canAdd={!busy && !previewOnly && canUsePersonalBookmarks} canReadLater={canUsePersonalBookmarks && !previewOnly} canOpenBookmark={!busy && !previewOnly && canUsePersonalBookmarks} onOpenBookmark={onRevealBookmark ?? onOpen} sourceList={<><div className="vault-feed-sources">{visible.map(item => { const preview = feedIndex.previews[item.path]; return <button key={item.path} disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={`Open ${preview?.title || fallbackTitle(item)}`}><span className="vault-feed-source-icon" aria-hidden="true">◉</span><span><strong>{preview?.title || fallbackTitle(item)}</strong><small>{typeof preview?.document?.content.fields.feedUrl === "string" ? preview.document.content.fields.feedUrl : "Open latest stories"}</small></span><span aria-hidden="true">›</span></button>; })}</div>{filePages}</>} /> : template && layout === "index" ? <div className="vault-folder-table-wrapper"><table className="vault-folder-table"><thead><tr><th>Title</th><th>Source</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map((item) => {
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
