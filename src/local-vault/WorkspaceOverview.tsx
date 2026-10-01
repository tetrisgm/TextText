import { useState } from "react";
import { FolderPresentation } from "./FolderPresentation";
import type { VaultListing } from "./bridge";
import { folderTree, folderPaths, folderForItem } from "./folders";
import { useVaultTemplates, VaultTemplateCards } from "./LocalTemplateLibrary";
import { VaultDocumentGrid } from "./VaultDocumentGrid";
const destinations: Record<string, string> = { note: "Notes", bookmark: "Reading", article: "Reading", project: "Projects", brief: "Projects", todo: "Tasks", timeline: "Journal", page: "Writing", casestudy: "Writing", gallery: "Gallery", talk: "Presentations" };
export function WorkspaceOverview({ listing, folder, busy, canCreate = true, sharedView = false, onFolder, onOpen, onCreate, onCustomize, onShare }: {
  listing: VaultListing; folder: string; busy: boolean; canCreate?: boolean; sharedView?: boolean;
  onFolder: (path: string) => void; onOpen: (path: string) => void; onCreate: (path: string, folder: string) => void;
  onCustomize?: (path: string) => void;
  onShare?: (folder: string) => void;
}) {
  const [showTemplates, setShowTemplates] = useState(false);
  const folders = folderPaths(folderTree(listing.items, listing.folders)).filter((path) => folderForItem(path) === folder);
  return <div className="vault-overview">
    <header><p className="vault-eyebrow">{listing.name || listing.root.split("/").at(-1)}</p>
      <div className="vault-overview-heading"><h2>{folder || (sharedView ? "Shared workspace" : "Your workspace")}</h2>{folder && onShare && <button onClick={() => onShare(folder)}>Share</button>}</div>
      <p>{sharedView ? "Files and folders shared with you." : folder === "Templates" ? "Edit these files to make the templates your own. Creating from a template keeps the original." : "Write, collect, and build from the files in your folders."}</p></header>
    {!!folders.length && <section aria-label="Folders"><h3>Folders</h3><div className="vault-folder-grid">{folders.map((path) => <button disabled={busy} key={path} onClick={() => onFolder(path)}><span aria-hidden="true">▱</span><strong>{path.split("/").at(-1)}</strong><small>{listing.items.filter((item) => item.path.startsWith(path + "/")).length} items</small></button>)}</div></section>}
    {canCreate && <button className="vault-template-toggle" aria-expanded={showTemplates} onClick={() => setShowTemplates((value) => !value)}>{showTemplates ? "Hide templates" : "Start with a template"}</button>}
    {canCreate && showTemplates && <StarterTemplates listing={listing} folder={folder} busy={busy} stayInFolder={sharedView} onCreate={onCreate} />}
    {sharedView ? <VaultDocumentGrid key={`${listing.root}:${folder}`} listing={listing} folder={folder} busy={busy} onOpen={onOpen} emptyMessage="No shared files in this folder." /> :
      <FolderPresentation key={`${listing.root}:${folder}`} listing={listing} folder={folder} busy={busy} editable={canCreate} onOpen={onOpen} onCustomize={onCustomize} />}
  </div>;
}

function StarterTemplates({ listing, folder, busy, stayInFolder, onCreate }: {
  listing: VaultListing; folder: string; busy: boolean; stayInFolder: boolean; onCreate: (path: string, folder: string) => void;
}) {
  const { looks, loading, notice, reload } = useVaultTemplates(listing.root);
  return <section aria-label="Ready-to-use templates"><h3>Start with a template</h3><p>Complete documents with their own layouts. Your copy is a new file, ready to edit with your assistant.</p>
    {loading && <p role="status">Loading templates…</p>}{notice && <p role="status">{notice} <button onClick={reload}>Retry</button></p>}
    <VaultTemplateCards looks={looks} disabled={busy} onChoose={(look) => { if (look.path) onCreate(look.path,
      stayInFolder ? folder : folder && folder !== "Templates" ? folder : destinations[look.template.id.replace(/^texttext\./, "")] || "Notes"); }} />
  </section>;
}
