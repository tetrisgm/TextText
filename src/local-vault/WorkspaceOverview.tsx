import { FolderPresentation } from "./FolderPresentation";
import type { VaultListing } from "./bridge";
import { VaultDocumentGrid } from "./VaultDocumentGrid";
import type { NoteColor } from "@/lib/note-colors";
import type { GalleryCommentsAccess } from "./VaultGalleryLightbox";
export function WorkspaceOverview({ listing, folder, busy, canCreate = true, sharedView = false, designOpen = false, onOpen, onEditNote, onRevealBookmark, onCreateNote, onCreateCard, onQuickSaveBookmark, onAskBookmarkAgent, onCustomize, onCloseDesign, preferredBookmarkPath, galleryCommentsAccess }: {
  listing: VaultListing; folder: string; busy: boolean; canCreate?: boolean; sharedView?: boolean;
  designOpen?: boolean; preferredBookmarkPath?: string; galleryCommentsAccess?: GalleryCommentsAccess;
  onOpen: (path: string) => void;
  onEditNote?: (path: string) => void;
  onRevealBookmark?: (path: string) => void;
  onCreateNote?: (pastedText?: string) => void;
  onCreateCard?: (title: string, body: string, tags: string[], images: File[], color: NoteColor, onCreated: () => void) => void;
  onQuickSaveBookmark?: (address: string) => Promise<void>;
  onAskBookmarkAgent?: (path: string, question: string) => void;
  onCustomize?: (path: string) => void;
  onCloseDesign?: () => void;
}) {
  return <div className={`vault-overview${folder === "Gallery" ? " vault-gallery-overview" : ""}`}>
    {sharedView ? <VaultDocumentGrid key={`${listing.root}:${folder}`} listing={listing} folder={folder} busy={busy} onOpen={onOpen} onEditNote={onEditNote} canUsePersonalBookmarks={false} onCreateNote={canCreate ? onCreateNote : undefined} onCreateCard={canCreate ? onCreateCard : undefined} onQuickSaveBookmark={canCreate ? onQuickSaveBookmark : undefined} onAskBookmarkAgent={onAskBookmarkAgent} preferredBookmarkPath={preferredBookmarkPath} galleryCommentsAccess={galleryCommentsAccess} emptyMessage="No shared files in this folder." /> :
      <FolderPresentation key={`${listing.root}:${folder}`} listing={listing} folder={folder} busy={busy} editable={canCreate}
        designOpen={designOpen} onOpen={onOpen} onEditNote={onEditNote} onRevealBookmark={onRevealBookmark} onCreateNote={canCreate ? onCreateNote : undefined} onCreateCard={canCreate ? onCreateCard : undefined} onQuickSaveBookmark={canCreate ? onQuickSaveBookmark : undefined} onAskBookmarkAgent={onAskBookmarkAgent} onCustomize={onCustomize} onCloseDesign={onCloseDesign} preferredBookmarkPath={preferredBookmarkPath} galleryCommentsAccess={galleryCommentsAccess} />}
  </div>;
}
