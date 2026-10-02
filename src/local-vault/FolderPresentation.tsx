import { useEffect, useRef, useState } from "react";
import { vaultRequest, type VaultFile, type VaultListing } from "./bridge";
import { createFolderViewPack, resolveFolderView, type FolderView, type FolderViewMetadata } from "./folder-view";
import { FOLDER_PRESETS } from "./folder-presets";
import { encodeBase64 } from "./image-import";
import { prepareTemplateProposal } from "./template-proposal";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { VaultDocumentGrid } from "./VaultDocumentGrid";

export function FolderPresentation({ listing, folder, busy, editable = true, designOpen = false, onOpen, onEditNote, onRevealBookmark, onCreateNote, onQuickSaveBookmark, onCustomize, onCloseDesign, preferredBookmarkPath }: {
  listing: VaultListing; folder: string; busy: boolean; editable?: boolean; onOpen: (path: string) => void; onEditNote?: (path: string) => void; onRevealBookmark?: (path: string) => void; onCreateNote?: (pastedText?: string) => void; onQuickSaveBookmark?: (address: string) => Promise<void>; onCustomize?: (path: string) => void;
  designOpen?: boolean; onCloseDesign?: () => void; preferredBookmarkPath?: string;
}) {
  const [view, setView] = useState<FolderView | null>(null);
  const [draft, setDraft] = useState<TemplateDefinition | null>(null);
  const draftBase = useRef<FolderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void vaultRequest<{ files: FolderViewMetadata[] }>("folderViews", { folder }).then(({ files }) => {
      const found = resolveFolderView(files, folder);
      if (active) { setView(found); setError(""); }
    }).catch((error: Error) => { if (active) { setView(null); setError(error.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [listing, folder]);
  const keep = async () => {
    if (!editable || !draft || saving || loading || busy) return;
    setSaving(true); setError("");
    try {
      const fresh = await vaultRequest<{ files: FolderViewMetadata[] }>("folderViews", { folder });
      const current = resolveFolderView(fresh.files, folder);
      const base = draftBase.current;
      if (current?.path !== base?.path || current?.hash !== base?.hash) throw new Error("The folder design changed. Cancel this preview and choose a design again.");
      if (base) {
        const file = await vaultRequest<VaultFile>("read", { path: base.path });
        const { payload } = prepareTemplateProposal(file, { path: base.path, hash: base.hash, templateJSON: JSON.stringify(draft) });
        const saved = await vaultRequest<VaultFile>("write", payload);
        if (saved.templateJSON !== payload.templateJSON) throw new Error("The saved folder design differs from the preview. Open its file to inspect it.");
      } else {
        const candidate = createFolderViewPack(folder, draft, listing.items);
        await vaultRequest("importPack", { title: "Folder view", folder, exactPath: candidate.path, data: encodeBase64(candidate.bytes) });
      }
      setDraft(null);
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (error) { setError(error instanceof Error ? error.message : "This folder design could not be saved."); }
    finally { setSaving(false); }
  };
  return <section aria-label="Folder presentation">
    {designOpen && <div className="vault-folder-design-controls">
      {editable && <label>Folder design <select aria-label="Folder design" disabled={busy || loading || saving} value={draft?.id ?? ""} onChange={(event) => { draftBase.current = view; setDraft(FOLDER_PRESETS.find((template) => template.id === event.target.value) ?? null); }}>
        <option value="">{view?.template.name || "Standard view"}</option>
        {FOLDER_PRESETS.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select></label>}
      {editable && draft && <><button disabled={busy || saving} onClick={() => void keep()}>{saving ? "Saving…" : "Keep folder design"}</button><button disabled={saving} onClick={() => setDraft(null)}>Cancel preview</button></>}
      {!draft && view && <><button disabled={busy || saving} onClick={() => onOpen(view.path)}>Open design file</button>{onCustomize && <button disabled={busy || saving} onClick={() => onCustomize(view.path)}>Customize folder</button>}</>}
      {!draft && onCloseDesign && <button disabled={saving} onClick={onCloseDesign}>Done</button>}
    </div>}
    {designOpen && editable && draft && <p role="status">Previewing {draft.name}. Keeping this design changes only the folder’s design file.</p>}
    {error && <p role="alert">{error} Your files remain available below.</p>}
    <VaultDocumentGrid key={`${listing.root}:${folder}`} listing={listing} folder={folder} busy={busy || saving} onOpen={onOpen} onEditNote={editable ? onEditNote : undefined} onRevealBookmark={onRevealBookmark} onCreateNote={editable ? onCreateNote : undefined} onQuickSaveBookmark={editable ? onQuickSaveBookmark : undefined} preferredBookmarkPath={preferredBookmarkPath} folderTemplate={editable ? draft ?? view?.template : view?.template} excludedPath={view?.path}
      emptyMessage={editable ? ({ Bookmarks: "Save a web address to start your reading library.", Gallery: "Add images to start your visual library.", Feeds: "Add a source to see its latest stories here.", Blog: "Write a story to start your publication.", Notes: "Create a note to start your card library." } as Record<string, string>)[folder] || "No files here yet. Choose a template to get started." : "No files in this folder."} />
  </section>;
}
