import type { VaultListing } from "./bridge";
import { folderTree, folderPaths, folderForItem } from "./folders";
import { useVaultTemplates, VaultTemplateCards } from "./LocalTemplateLibrary";
const destinations: Record<string, string> = { note: "Notes", bookmark: "Reading", article: "Reading", project: "Projects", brief: "Projects", todo: "Tasks", timeline: "Journal", page: "Writing", casestudy: "Writing", gallery: "Gallery", talk: "Presentations" };
export function WorkspaceOverview({ listing, folder, busy, onFolder, onOpen, onCreate }: {
  listing: VaultListing; folder: string; busy: boolean;
  onFolder: (path: string) => void; onOpen: (path: string) => void; onCreate: (path: string, folder: string) => void;
}) {
  const { looks, loading, notice, reload } = useVaultTemplates(listing.root);
  const folders = folderPaths(folderTree(listing.items, listing.folders)).filter((path) => folderForItem(path) === folder);
  const items = listing.items.filter((item) => folder ? folderForItem(item.path) === folder : !item.path.startsWith("Templates/"));
  return <div className="vault-overview">
    <header><p className="vault-eyebrow">{listing.name || listing.root.split("/").at(-1)}</p>
      <h2>{folder || "Your workspace"}</h2><p>{folder === "Templates" ? "Edit these files to make the templates your own. Creating from a template keeps the original." : "Write, collect, and build from the files in your folders."}</p></header>
    {!!folders.length && <section aria-label="Folders"><h3>Folders</h3><div className="vault-folder-grid">{folders.map((path) => <button disabled={busy} key={path} onClick={() => onFolder(path)}><span aria-hidden="true">▱</span><strong>{path.split("/").at(-1)}</strong><small>{listing.items.filter((item) => item.path.startsWith(path + "/")).length} items</small></button>)}</div></section>}
    <section aria-label="Ready-to-use templates"><h3>Start with a template</h3><p>Complete documents with their own layouts. Your copy is a new file, ready to edit with your assistant.</p>
      {loading && <p role="status">Loading templates…</p>}{notice && <p role="status">{notice} <button onClick={reload}>Retry</button></p>}
      <VaultTemplateCards looks={looks} disabled={busy} onChoose={(look) => { if (look.path) onCreate(look.path, folder && folder !== "Templates" ? folder : destinations[look.template.id.replace(/^texttext\./, "")] || "Notes"); }} />
    </section>
    <section aria-label="Documents"><h3>{folder ? "Files" : "Explore your documents"}</h3><div className="vault-document-grid">{items.map((item) => <button disabled={busy} key={item.path} onClick={() => onOpen(item.path)}><strong>{item.title || item.path.split("/").at(-1)?.replace(/\.textpack$/i, "")}</strong><small>{folderForItem(item.path) || "Workspace"}</small><span>Open →</span></button>)}</div>{!items.length && <p>No files here yet. Choose a template below to get started.</p>}</section>
  </div>;
}
