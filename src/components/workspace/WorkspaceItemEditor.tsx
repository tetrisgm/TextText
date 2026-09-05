"use client";

// The document editor's mount point, in its own module so it can be loaded
// on demand.
//
// It pulls in Yjs, y-protocols and the collaborative editor, which is the
// largest thing the workspace was parsing on every load - including a list
// view where nobody is editing anything. Keeping it beside the reader in
// WorkspaceItemViews meant importing the reader imported all of it.

// The read and edit views of one open item inside the workspace shell,
// plus their small shared bodies. Extracted from the PostWorkspaceShell
// monolith.

import { detachedSlice } from "@/lib/detached-slice";
import { useClientHydrated } from "@/lib/use-client-hydrated";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
} from "react";
import { usePresence } from "@/lib/collab/usePresence";
import { BacklinksPanel } from "@/components/BacklinksPanel";
import { saveItemAsLookAction } from "@/app/editor/look-actions";
import { UnifiedDocumentEditor } from "@/components/document/UnifiedDocumentEditor";
import { UnifiedDocumentReader } from "@/components/document/UnifiedDocumentReader";
import {
  type FolderCaptureResolved,
  type FolderDeleteItem,
} from "@/components/workspace/UniversalItemComposer";
import {
  PostActionBar,
  type BookmarkContentMode,
} from "@/components/PostActionBar";
import { ReaderComments } from "@/components/workspace/ReaderComments";
import { ReaderFindHighlights } from "@/components/workspace/ReaderFindHighlights";
import type { AiConnectionSnapshot } from "@/lib/ai/connection-state";
import { assistantAgentIdentity } from "@/components/workspace/assistant/agent-identity";
import type {
  Blog,
  Post,
} from "@/lib/content";
import { legacyProjectionFromDocument } from "@/lib/documents/legacy";
import type { DocumentSnapshot } from "@/lib/documents/model";
import {
  adjacentPublishedPostsForPool,
  backlinksForPost,
  findPoolPostById,
  folderPathForPoolPost,
  postFromPoolPost,
  templateForPoolPost,
} from "@/lib/pool/selectors";
import {
  acknowledgePost,
  acknowledgePostDocument,
  getCachedWorkspacePostDocument,
  updatePost,
  updatePostDocument,
  useWorkspacePostDocument,
} from "@/lib/pool/store";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import { workspaceReferenceChoices } from "@/lib/presentation/workspace-reference-choices";
import {
  blogWorkspacePostPath,
  workspacePublicPostUrl,
} from "@/lib/public-paths";
import { localizeRemoteMarkdownImages } from "@/lib/markdown-images";
import { stripRedundantBookmarkLead } from "@/lib/bookmark-display";
import {
  folderWorkspaceHref,
  isOptimisticPostId,
} from "@/lib/workspace/local-view";
import {
  workspaceSearchHref,
  type WorkspaceSearchLocation,
} from "@/lib/workspace-navigation";
import {
  ErrorBody,
  collaboratorColor,
} from "@/components/workspace/WorkspaceItemViews";


export function LocalUnifiedWorkspacePostEditor({
  active,
  blog,
  editorIdentity,
  homePath,
  onDeleteItem,
  onNavigate,
  pool,
  poolPost,
  returnToSearch,
  assistantConnection,
  assistantCloudProvider,
  onOpenAssistant,
}: {
  active: boolean;
  blog: Blog;
  editorIdentity: string;
  homePath: string;
  onDeleteItem?: FolderDeleteItem;
  onNavigate: (path: string) => Promise<void> | void;
  pool: WorkspacePoolPayload;
  poolPost: WorkspacePoolPost;
  returnToSearch?: WorkspaceSearchLocation;
  assistantConnection?: AiConnectionSnapshot | null;
  assistantCloudProvider?: string | null;
  onOpenAssistant?: () => void;
}) {
  const activeAgent = assistantAgentIdentity(
    assistantCloudProvider,
    assistantConnection,
    collaboratorColor,
  );
  const template = templateForPoolPost(pool, poolPost);
  // The authoritative body may not be local yet. The pool list omits document
  // bodies, and the cache only knows what THIS browser typed or fetched, so an
  // item written by an agent (or another device) arrived here as an empty
  // editor one keystroke away from overwriting real content with "". The
  // editor now refuses to mount until the body entry resolves; an empty
  // baseline may only mean "this item is empty", never "the fetch had not
  // happened yet".
  const initialDocument =
    pool.initialDocuments?.find(
      (candidate) => candidate.postId === poolPost.id,
    ) ?? null;
  const documentState = useWorkspacePostDocument(
    pool.blogId,
    poolPost.id,
    initialDocument,
  );
  const poolDocument = poolPost.document ?? initialDocument?.document;
  const cachedDocument = getCachedWorkspacePostDocument(
    pool.blogId,
    poolPost.id,
  )?.document;
  // Hydration-safe: the server and the first client render may consult only
  // what the RSC payload carries (poolBody). The body cache and fetch entry
  // are client module state; letting them into the first render made the
  // server and client disagree and hydration fail. After mount, the client
  // may know more.
  const bodySourcesMounted = useClientHydrated();
  const document =
    poolDocument ??
    (bodySourcesMounted
      ? (cachedDocument ??
        (documentState.entry.status === "ready"
          ? documentState.entry.document.document
          : undefined))
      : undefined);
  useEffect(() => {
    if (!poolDocument && !cachedDocument) documentState.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.blogId, poolPost.id]);
  const post = {
    ...postFromPoolPost(poolPost, document?.content.body ?? ""),
    document,
  };
  const containingFolderPath = folderPathForPoolPost(pool, poolPost);
  const containingFolderHref = returnToSearch
    ? workspaceSearchHref(homePath, returnToSearch)
    : folderWorkspaceHref(homePath, containingFolderPath);
  const referenceChoices = useMemo(
    () => workspaceReferenceChoices(pool.posts, poolPost.id),
    [pool.posts, poolPost.id],
  );

  const updateLocalDocument = useCallback(
    (nextDocument: DocumentSnapshot) => {
      const projection = legacyProjectionFromDocument(nextDocument);
      updatePost(poolPost.id, {
        template: nextDocument.presentation.template,
        title: projection.title,
        excerpt: projection.excerpt || undefined,
        // See detachedSlice: a plain cut pins the whole body.
        bodyPreview: detachedSlice(projection.body, 2048) || undefined,
        accent: projection.accent ?? undefined,
        cover: projection.cover ?? undefined,
        coverCaption: projection.coverCaption ?? undefined,
        coverHeight: projection.coverHeight ?? undefined,
        gallery: projection.gallery,
        links: projection.links ?? undefined,
        tags: projection.tags,
        videoUrl: projection.videoUrl ?? undefined,
        venue: projection.venue ?? undefined,
        duration: projection.duration ?? undefined,
      });
      updatePostDocument(pool.blogId, poolPost.id, nextDocument);
    },
    [pool.blogId, poolPost.id],
  );

  const acknowledgeMaterialized = useCallback(
    (nextDocument: DocumentSnapshot, revision?: number) => {
      updateLocalDocument(nextDocument);
      acknowledgePost(poolPost.id);
      acknowledgePostDocument(
        pool.blogId,
        poolPost.id,
        nextDocument,
        revision,
      );
    },
    [pool.blogId, poolPost.id, updateLocalDocument],
  );

  if (!document) {
    // See the gate in openPoolPost: skeleton placeholders are banned (they
    // read as ghosting); reaching here without a document is a sub-frame
    // transient or an error.
    return documentState.entry.status === "error" ? (
      <ErrorBody message={documentState.entry.error} />
    ) : null;
  }

  return (
    <UnifiedDocumentEditor
      active={active}
      blog={blog}
      post={post}
      template={template}
      availableTemplates={pool.templates}
      referenceChoices={referenceChoices}
      onSaveAsLook={async (name) => {
        if (!post.id) return { ok: false, message: "Save the item first." };
        const result = await saveItemAsLookAction(blog.handle, post.id, name);
        return result.ok
          ? { ok: true, message: `Saved as "${result.name}"` }
          : { ok: false, message: result.error };
      }}
      activeAgent={activeAgent}
      onOpenAgent={onOpenAssistant}
      collab={{
        postId: poolPost.id,
        userName: blog.author || "You",
        color: collaboratorColor(editorIdentity),
        canEdit: true,
      }}
      onDocumentChange={updateLocalDocument}
      onMaterialized={acknowledgeMaterialized}
      onDelete={
        onDeleteItem ? () => Promise.resolve(onDeleteItem(post)) : undefined
      }
      onDone={() =>
        onNavigate(
          template.id === "texttext.note"
            ? containingFolderHref
            : blogWorkspacePostPath(blog, containingFolderPath, post),
        )
      }
    />
  );
}
