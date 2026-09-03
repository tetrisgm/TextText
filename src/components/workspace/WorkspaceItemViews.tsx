"use client";

// The read and edit views of one open item inside the workspace shell,
// plus their small shared bodies. Extracted from the PostWorkspaceShell
// monolith.

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
} from "@/components/FolderPage";
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



export function ErrorBody({ message }: { message: string }) {
  return <p className="workspace-post-body-status">{message}</p>;
}

export function safeBookmarkViewUrl(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return "";
  }
  return "";
}

export function BookmarkViewBody({ post }: { post: Post }) {
  const title = post.title.trim() || post.capture?.title?.trim() || "Bookmark";
  const screenshotUrl = safeBookmarkViewUrl(post.capture?.screenshotUrl);
  const screenshotTiles = (post.capture?.screenshotTiles ?? [])
    .map((tile) => ({ ...tile, url: safeBookmarkViewUrl(tile.url) }))
    .filter((tile) => tile.url)
    .sort((a, b) => a.index - b.index);
  if (screenshotTiles.length > 0 || screenshotUrl) {
    return (
      <section className="bookmark-reader-view is-capture">
        {(screenshotTiles.length > 0
          ? screenshotTiles
          : [{ index: 0, url: screenshotUrl }]
        ).map((tile) => (
          // Captures are already compressed, immutable artifacts.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${tile.index}:${tile.url}`}
            src={tile.url}
            alt={tile.index === 0 ? `Full-page capture of ${title}` : ""}
            decoding="async"
            loading={tile.index === 0 ? "eager" : "lazy"}
          />
        ))}
      </section>
    );
  }

  return <ErrorBody message="This bookmark capture is not available yet." />;
}

export function WorkspacePostReader({
  blog,
  canCommentPost,
  canManagePost,
  homePath,
  onCaptureResolved,
  onNavigate,
  onSearch,
  searchFocusRequestKey,
  pool,
  poolPost,
  returnToSearch,
}: {
  blog: Blog;
  canCommentPost: boolean;
  canManagePost: boolean;
  homePath: string;
  onCaptureResolved?: FolderCaptureResolved;
  onNavigate: (path: string) => Promise<void> | void;
  onOpenTag: (tag: string) => void;
  onSearch: () => void;
  searchFocusRequestKey: number;
  pool: WorkspacePoolPayload;
  poolPost: WorkspacePoolPost;
  returnToSearch?: WorkspaceSearchLocation;
}) {
  const initialDocument =
    pool.initialDocuments?.find(
      (document) => document.postId === poolPost.id,
    ) ?? null;
  const { entry, load, stale } = useWorkspacePostDocument(
    pool.blogId,
    poolPost.id,
    initialDocument,
  );
  const [bookmarkContentState, setBookmarkContentState] = useState<{
    mode: BookmarkContentMode;
    postId: string;
  }>(() => ({ mode: "readable", postId: poolPost.id }));
  const bookmarkContentMode =
    bookmarkContentState.postId === poolPost.id
      ? bookmarkContentState.mode
      : "readable";
  const setBookmarkContentMode = useCallback(
    (mode: BookmarkContentMode) => {
      setBookmarkContentState({ mode, postId: poolPost.id });
    },
    [poolPost.id],
  );
  const [findState, setFindState] = useState({
    postId: poolPost.id,
    query: "",
  });
  const optimistic = isOptimisticPostId(poolPost.id);
  const readerPeers = usePresence(optimistic ? null : poolPost.id);
  const findQuery = findState.postId === poolPost.id ? findState.query : "";
  const setFindQuery = useCallback(
    (query: string) => setFindState({ postId: poolPost.id, query }),
    [poolPost.id],
  );

  useEffect(() => {
    if (poolPost.document) return;
    if (entry.status === "idle" || stale) load(stale);
  }, [entry.status, load, poolPost.document, stale]);

  const document =
    poolPost.document ??
    (entry.status === "ready" ? entry.document.document : undefined);
  const body = document?.content.body ?? "";
  const post = useMemo(
    () => ({ ...postFromPoolPost(poolPost, body), document }),
    [body, document, poolPost],
  );
  const bodyImageReplacements = new Map(
    (post.capture?.assets ?? [])
      .filter((asset) => asset.originalUrl && asset.url)
      .map((asset) => [asset.originalUrl, asset.url] as const),
  );
  const bodyMarkdown =
    post.type === "bookmark"
      ? stripRedundantBookmarkLead(
          localizeRemoteMarkdownImages(body, bodyImageReplacements),
          {
            title: post.title,
            excerpt: post.excerpt,
            sourceUrl: post.capture?.url ?? post.links?.[0]?.href,
            siteName: post.capture?.siteName,
          },
        )
      : body;
  const readablePost = useMemo(
    () => ({
      ...post,
      body: bodyMarkdown,
      document: post.document
        ? {
            ...post.document,
            content: { ...post.document.content, body: bodyMarkdown },
          }
        : undefined,
    }),
    [bodyMarkdown, post],
  );
  const backlinks = useMemo(
    () => backlinksForPost(pool, poolPost),
    [pool, poolPost],
  );
  const template = useMemo(
    () => templateForPoolPost(pool, poolPost),
    [pool, poolPost],
  );
  const adjacent = useMemo(
    () => adjacentPublishedPostsForPool(pool, post.id ?? post.slug),
    [pool, post.id, post.slug],
  );
  const adjacentPath = (link: NonNullable<typeof adjacent.previous>) => {
    const adjacentPost = link.id ? findPoolPostById(pool, link.id) : null;
    return adjacentPost
      ? blogWorkspacePostPath(
          blog,
          folderPathForPoolPost(pool, adjacentPost),
          adjacentPost,
        )
      : undefined;
  };
  const sectionPath = returnToSearch
    ? workspaceSearchHref(homePath, returnToSearch)
    : folderWorkspaceHref(homePath, folderPathForPoolPost(pool, poolPost));

  return (
    <>
      <PostActionBar
        mode="read"
        owner
        blog={blog}
        post={post}
        presencePeers={readerPeers}
        adjacent={adjacent}
        previousPath={
          adjacent.previous ? adjacentPath(adjacent.previous) : undefined
        }
        nextPath={adjacent.next ? adjacentPath(adjacent.next) : undefined}
        homePath={sectionPath}
        postPath={blogWorkspacePostPath(
          blog,
          folderPathForPoolPost(pool, poolPost),
          post,
        )}
        publishedUrl={
          workspacePublicPostUrl(
            blog.handle,
            folderPathForPoolPost(pool, poolPost),
            post.slug,
          ) ?? undefined
        }
        bookmarkContentMode={bookmarkContentMode}
        canCommentPost={canCommentPost}
        canEditPost
        canManagePost={canManagePost}
        onBookmarkCaptureChange={onCaptureResolved}
        onNavigate={async (path) => {
          await onNavigate(path);
        }}
        onSearch={onSearch}
        searchFocusRequestKey={searchFocusRequestKey}
        searchValue={findQuery}
        onSearchValueChange={setFindQuery}
        onBookmarkContentModeChange={setBookmarkContentMode}
      />
      {post.type === "bookmark" && bookmarkContentMode === "capture" ? (
        <BookmarkViewBody post={post} />
      ) : document ? (
        <UnifiedDocumentReader
          blog={blog}
          post={readablePost}
          template={template}
        />
      ) : entry.status === "error" ? (
        <ErrorBody message={entry.error} />
      ) : // Never a skeleton: the view only switches here once the document
      // is locally available (openPoolPost gates on it), so this branch is
      // a sub-frame transient at most and must paint nothing.
      null}
      <ReaderFindHighlights query={findQuery} />
      {canCommentPost && post.id && !optimistic && document && (
        <ReaderComments
          key={post.id}
          canResolve={canManagePost}
          handle={blog.handle}
          postId={post.id}
          sourceBody={body}
        />
      )}
      <BacklinksPanel blog={blog} posts={backlinks} onNavigate={onNavigate} />
    </>
  );
}

export function collaboratorColor(identity: string): string {
  const palette = ["#0071e3", "#34c759", "#ff9f0a", "#af52de", "#ff375f"];
  let hash = 0;
  for (const character of identity) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

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
        bodyPreview: projection.body.slice(0, 2048) || undefined,
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

