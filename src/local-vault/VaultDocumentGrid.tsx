import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { DocumentCollectionRenderer } from "@/components/document/DocumentRenderer";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { selectCollectionView } from "@/lib/presentation/collection-views";
import { vaultRequest, type VaultListing } from "./bridge";
import { folderForItem } from "./folders";
import { collectionDocument, collectionMembers, queryFolderMembers, type FolderPreview } from "./folder-collection";

const PAGE_SIZE = 24;
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
export function VaultDocumentGrid({ listing, folder, busy, onOpen, folderTemplate, excludedPath, previewOnly = false, emptyMessage }: {
  listing: VaultListing; folder: string; busy: boolean; onOpen: (path: string) => void;
  folderTemplate?: TemplateDefinition; excludedPath?: string; previewOnly?: boolean; emptyMessage?: string;
}) {
  const [page, setPage] = useState(0);
  const [view, setView] = useState("");
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
  const lastPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = useMemo(() => items.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), [items, currentPage]);
  const visibleKey = JSON.stringify([listing, visible.map((item) => item.path)]);
  useEffect(() => {
    if (busy) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setPreviews({});
      for (const item of visible) {
        if (!active) return;
        try {
          const preview = await requestPreview(item.path, () => active);
          if (active && preview) setPreviews((previous) => ({ ...previous, [item.path]: preview }));
        } catch { /* The original stays accessible when its preview cannot be read. */ }
      }
    });
    return () => { active = false; };
    // Key tracks the listing revision and visible paths; query results create fresh arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, visibleKey]);
  const requestedLayout = template?.collection.layout || "cards";
  const supported = ["cards", "list", "index"].includes(requestedLayout);
  const layout = supported ? requestedLayout : "list";
  const fallbackTitle = (item: VaultListing["items"][number]) => item.title || item.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Untitled";
  return <section aria-label="Documents"><h3>{folder ? "Files" : "Explore your documents"}</h3>
    {template && template.collection.views.length > 0 && <label>Folder view <select aria-label="Folder view" value={view || template.collection.defaultView || ""} onChange={(event) => { setView(event.target.value); setPage(0); }}><option value="">Default</option>{template.collection.views.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
    {!supported && <p role="status">The {requestedLayout} layout is not available here yet. Showing a readable list.</p>}
    {queryMessage && <p role="status">{queryMessage}</p>}
    {template && layout === "index" ? <div className="vault-folder-table-wrapper"><table className="vault-folder-table"><thead><tr><th>Title</th><th>Source</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map((item) => {
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
    {!items.length && <p>{members.length ? "No files match this view." : emptyMessage ?? "No files here yet. Choose a template to get started."}</p>}
    {lastPage > 0 && <nav className="vault-file-pages" aria-label="File pages"><button disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {lastPage + 1}</span><button disabled={busy || currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
  </section>;
}
