import { useEffect, useRef, useState } from "react";
import { vaultRequest, type VaultFile, type VaultListing } from "./bridge";
import { createFolderViewPack, resolveFolderView, folderCollectionTemplate, explicitFolderDesignPayload, folderDefaultPayload, readFolderItemDefault, FOLDER_DEFAULT_FIELD, FOLDER_STANDARD_LAYOUT_FIELD, type FolderView, type FolderViewMetadata } from "./folder-view";
import { FOLDER_PRESETS } from "./folder-presets";
import { encodeBase64 } from "./image-import";
import { prepareTemplateProposal } from "./template-proposal";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { VaultDocumentGrid } from "./VaultDocumentGrid";
import type { NoteColor } from "@/lib/note-colors";
import type { GalleryCommentsAccess } from "./VaultGalleryLightbox";
import { getBuiltinTemplate, requireBuiltinTemplate, TEMPLATE_CATALOG } from "@/lib/presentation/templates";
import { encodePack, openPack } from "./pack";
import { writePayload } from "./model";

export function FolderPresentation({ listing, folder, busy, editable = true, designOpen = false, onOpen, onEditNote, onRevealBookmark, onCreateNote, onCreateCard, onQuickSaveBookmark, onAskBookmarkAgent, onAskGalleryAgent, onCustomize, onCloseDesign, preferredBookmarkPath, galleryCommentsAccess }: {
  listing: VaultListing; folder: string; busy: boolean; editable?: boolean; onOpen: (path: string) => void; onEditNote?: (path: string) => void; onRevealBookmark?: (path: string) => void; onCreateNote?: (pastedText?: string) => void; onCreateCard?: (title: string, body: string, tags: string[], images: File[], color: NoteColor, onCreated: () => void, icon?: string) => void; onQuickSaveBookmark?: (address: string) => Promise<void>; onAskBookmarkAgent?: (path: string, question: string) => void; onAskGalleryAgent?: (path: string, task: string, imageAssetId?: string) => void; onCustomize?: (path: string) => void;
  designOpen?: boolean; onCloseDesign?: () => void; preferredBookmarkPath?: string; galleryCommentsAccess?: GalleryCommentsAccess;
}) {
  const [view, setView] = useState<FolderView | null>(null);
  const [draft, setDraft] = useState<TemplateDefinition | null>(null);
  const draftBase = useRef<FolderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaultChoice, setDefaultChoice] = useState<string | null>(null);
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
        const { payload } = prepareTemplateProposal(file, { path: base.path, hash: base.hash, templateJSON: JSON.stringify(draft), templateAuthoringSourceJSON: null });
        const saved = await vaultRequest<VaultFile>("write", explicitFolderDesignPayload(payload));
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
  let currentDefault: ReturnType<typeof readFolderItemDefault> = null;
  let defaultError = "";
  try { currentDefault = readFolderItemDefault(view); }
  catch (cause) { defaultError = cause instanceof Error ? cause.message : "This folder's default could not be read."; }
  const currentDefaultKey = currentDefault ? `${currentDefault.template.id}@${currentDefault.template.version}` : "";
  const choice = defaultChoice ?? currentDefaultKey;
  const keepDefault = async () => {
    if (!editable || defaultChoice === null || saving || loading || busy || defaultError) return;
    setSaving(true); setError("");
    try {
      const fresh = await vaultRequest<{ files: FolderViewMetadata[] }>("folderViews", { folder });
      const current = resolveFolderView(fresh.files, folder);
      if (current?.path !== view?.path || current?.hash !== view?.hash) throw new Error("The folder view changed. Reload it before saving a default.");
      const [templateId, templateVersion] = defaultChoice.split("@");
      const selected = defaultChoice === "" ? null : getBuiltinTemplate(templateId, Number(templateVersion));
      if (defaultChoice && !selected) throw new Error("Choose an available template for new items.");
      if (current) {
        const file = await vaultRequest<VaultFile>("read", { path: current.path });
        const saved = await vaultRequest<VaultFile>("write", folderDefaultPayload(file, current, selected));
        const updated = resolveFolderView([saved], folder);
        const stored = readFolderItemDefault(updated);
        if (!updated || stored?.template.id !== selected?.id || stored?.template.version !== selected?.version) throw new Error("The saved folder default differs from your selection. Open its file to inspect it.");
        setView(updated);
      } else {
        const candidate = createFolderViewPack(folder, requireBuiltinTemplate("texttext.note"), listing.items);
        const pack = openPack(candidate.bytes, candidate.path, "");
        const document = JSON.parse(pack.file.documentJSON!);
        document.content.fields[FOLDER_STANDARD_LAYOUT_FIELD] = "v1";
        if (selected) document.content.fields[FOLDER_DEFAULT_FIELD] = JSON.stringify({ version: 1, template: selected });
        const bytes = encodePack(pack, writePayload(pack.file, document));
        await vaultRequest("importPack", { title: "Folder view", folder, exactPath: candidate.path, data: encodeBase64(bytes) });
        const updated = await vaultRequest<{ files: FolderViewMetadata[] }>("folderViews", { folder });
        setView(resolveFolderView(updated.files, folder));
      }
      setDefaultChoice(null);
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (error) { setError(error instanceof Error ? error.message : "The folder default could not be saved."); }
    finally { setSaving(false); }
  };
  return <section aria-label="Folder presentation">
    {designOpen && <div className="vault-folder-design-controls">
      {editable && <label>Default for new items <select aria-label="Default for new items" disabled={busy || loading || saving || Boolean(defaultError)} value={choice} onChange={(event) => setDefaultChoice(event.target.value)}>
        <option value="">No folder default</option>
        {currentDefault && !TEMPLATE_CATALOG.some(({ id }) => id === currentDefault.template.id) && <option value={currentDefaultKey}>{currentDefault.template.name}</option>}
        {TEMPLATE_CATALOG.map(({ id }) => { const template = getBuiltinTemplate(id); return template ? <option key={id} value={`${template.id}@${template.version}`}>{template.name}</option> : null; })}
      </select></label>}
      {editable && defaultChoice !== null && defaultChoice !== currentDefaultKey && <><button disabled={busy || saving || Boolean(defaultError)} onClick={() => void keepDefault()}>{saving ? "Saving…" : "Keep default"}</button><button disabled={saving} onClick={() => setDefaultChoice(null)}>Cancel default</button></>}
      {editable && <label>Folder design <select aria-label="Folder design" disabled={busy || loading || saving} value={draft?.id ?? ""} onChange={(event) => { draftBase.current = view; setDraft(FOLDER_PRESETS.find((template) => template.id === event.target.value) ?? null); }}>
        <option value="">{folderCollectionTemplate(view)?.name || "Standard view"}</option>
        {FOLDER_PRESETS.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select></label>}
      {editable && draft && <><button disabled={busy || saving} onClick={() => void keep()}>{saving ? "Saving…" : "Keep folder design"}</button><button disabled={saving} onClick={() => setDraft(null)}>Cancel preview</button></>}
      {!draft && view && <><button disabled={busy || saving} onClick={() => onOpen(view.path)}>Open design file</button>{onCustomize && <button disabled={busy || saving} onClick={() => onCustomize(view.path)}>Customize folder</button>}</>}
      {!draft && onCloseDesign && <button disabled={saving} onClick={onCloseDesign}>Done</button>}
    </div>}
    {designOpen && editable && draft && <p role="status">Previewing {draft.name}. Keeping this design changes only the folder’s design file.</p>}
    {(error || defaultError) && <p role="alert">{error || defaultError} Your files remain available below.</p>}
    <VaultDocumentGrid key={`${listing.root}:${folder}`} listing={listing} folder={folder} busy={busy || saving} onOpen={onOpen} onEditNote={editable ? onEditNote : undefined} onRevealBookmark={onRevealBookmark} onCreateNote={editable ? onCreateNote : undefined} onCreateCard={editable ? onCreateCard : undefined} onQuickSaveBookmark={editable ? onQuickSaveBookmark : undefined} onAskBookmarkAgent={onAskBookmarkAgent} onAskGalleryAgent={onAskGalleryAgent} preferredBookmarkPath={preferredBookmarkPath} folderTemplate={editable ? draft ?? folderCollectionTemplate(view) : folderCollectionTemplate(view)} excludedPath={view?.path} galleryCommentsAccess={galleryCommentsAccess}
      emptyMessage={editable ? ({ Bookmarks: "Save a web address to start your reading library.", Gallery: "Add images to start your visual library.", Feeds: "Add a source to see its latest stories here.", Blog: "Write a story to start your publication.", Notes: "Create a note to start your card library." } as Record<string, string>)[folder] || "No files here yet. Choose a template to get started." : "No files in this folder."} />
  </section>;
}
