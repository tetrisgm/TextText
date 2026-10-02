import { FolderPresentation } from "./FolderPresentation";
import type { VaultListing } from "./bridge";
import { VaultDocumentGrid } from "./VaultDocumentGrid";
export function WorkspaceOverview({ listing, folder, busy, canCreate = true, sharedView = false, designOpen = false, onOpen, onEditNote, onRevealBookmark, onCreateNote, onQuickSaveBookmark, onCustomize, onCloseDesign, preferredBookmarkPath }: {
  listing: VaultListing; folder: string; busy: boolean; canCreate?: boolean; sharedView?: boolean;
  designOpen?: boolean; preferredBookmarkPath?: string;
  onOpen: (path: string) => void;
  onEditNote?: (path: string) => void;
  onRevealBookmark?: (path: string) => void;
  onCreateNote?: (pastedText?: string) => void;
  onQuickSaveBookmark?: (address: string) => Promise<void>;
  onCustomize?: (path: string) => void;
  onCloseDesign?: () => void;
}) {
  return <div className="vault-overview">
    {sharedView ? <VaultDocumentGrid key={`${listing.root}:${folder}`} listing={listing} folder={folder} busy={busy} onOpen={onOpen} onEditNote={onEditNote} canUsePersonalBookmarks={false} onCreateNote={canCreate ? onCreateNote : undefined} onQuickSaveBookmark={canCreate ? onQuickSaveBookmark : undefined} preferredBookmarkPath={preferredBookmarkPath} emptyMessage="No shared files in this folder." /> :
      <FolderPresentation key={`${listing.root}:${folder}`} listing={listing} folder={folder} busy={busy} editable={canCreate}
        designOpen={designOpen} onOpen={onOpen} onEditNote={onEditNote} onRevealBookmark={onRevealBookmark} onCreateNote={canCreate ? onCreateNote : undefined} onQuickSaveBookmark={canCreate ? onQuickSaveBookmark : undefined} onCustomize={onCustomize} onCloseDesign={onCloseDesign} preferredBookmarkPath={preferredBookmarkPath} />}
  </div>;
}
