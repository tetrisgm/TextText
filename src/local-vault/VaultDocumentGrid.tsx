import { useEffect, useMemo, useState } from "react";
import { vaultRequest, type VaultListing } from "./bridge";
import { folderForItem } from "./folders";

type Preview = { title: string; excerpt: string; sourceURL?: string; image?: { data: string; contentType: string } };
const PAGE_SIZE = 24;
let queue: Promise<unknown> = Promise.resolve();
function requestPreview(path: string, active: () => boolean): Promise<Preview | null> {
  const request = queue.then(() => active() ? vaultRequest<Preview>("preview", { path }) : null);
  queue = request.catch(() => null);
  return request;
}
export function VaultDocumentGrid({ listing, folder, busy, onOpen }: {
  listing: VaultListing; folder: string; busy: boolean; onOpen: (path: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const items = useMemo(() => listing.items.filter((item) => folder ? folderForItem(item.path) === folder : !item.path.startsWith("Templates/")), [listing, folder]);
  const lastPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = useMemo(() => items.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), [items, currentPage]);
  useEffect(() => {
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
  }, [visible]);
  return <section aria-label="Documents"><h3>{folder ? "Files" : "Explore your documents"}</h3>
    <div className="vault-document-grid">{visible.map((item) => {
      const preview = previews[item.path];
      const fallback = item.title || item.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Untitled";
      const image = preview?.image;
      const source = image && ["image/png", "image/jpeg"].includes(image.contentType) && image.data.length <= 700_000 ? `data:${image.contentType};base64,${image.data}` : null;
      return <button disabled={busy} key={item.path} aria-label={`${fallback} ${folderForItem(item.path) || "Workspace"} Open →`} onClick={() => onOpen(item.path)}>
        {source ? /* eslint-disable-next-line @next/next/no-img-element */
          <img className="vault-file-preview" src={source} alt="" loading="lazy" decoding="async" />
          : <p className="vault-file-excerpt">{preview?.excerpt || "Open this file to start reading or editing."}</p>}
        <strong>{preview?.title || fallback}</strong>
        <small>{folderForItem(item.path) || "Workspace"}</small>
        {preview?.sourceURL && <small className="vault-file-source">{preview.sourceURL}</small>}
        <span>Open →</span>
      </button>;
    })}</div>
    {!items.length && <p>No files here yet. Choose a template to get started.</p>}
    {lastPage > 0 && <nav className="vault-file-pages" aria-label="File pages">
      <button disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
      <span>Page {currentPage + 1} of {lastPage + 1}</span>
      <button disabled={busy || currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button>
    </nav>}
  </section>;
}
