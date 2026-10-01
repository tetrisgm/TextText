import { FolderPresentation } from "./FolderPresentation";
import type { VaultListing } from "./bridge";
import { VaultDocumentGrid } from "./VaultDocumentGrid";
export function WorkspaceOverview({ listing, folder, busy, canCreate = true, sharedView = false, designOpen = false, onOpen, onCustomize, onCloseDesign }: {
  listing: VaultListing; folder: string; busy: boolean; canCreate?: boolean; sharedView?: boolean;
  designOpen?: boolean;
  onOpen: (path: string) => void;
  onCustomize?: (path: string) => void;
  onCloseDesign?: () => void;
}) {
  return <div className="vault-overview">
    {sharedView ? <VaultDocumentGrid key={`${listing.root}:${folder}`} listing={listing} folder={folder} busy={busy} onOpen={onOpen} emptyMessage="No shared files in this folder." /> :
      <FolderPresentation key={`${listing.root}:${folder}`} listing={listing} folder={folder} busy={busy} editable={canCreate}
        designOpen={designOpen} onOpen={onOpen} onCustomize={onCustomize} onCloseDesign={onCloseDesign} />}
  </div>;
}
