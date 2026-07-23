import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { isAuthConfigured } from "@/auth";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { getCurrentUser } from "@/lib/session";
import { getSharedPostsForUser } from "@/lib/shares";
import { colorForSub } from "@/lib/collab";
import { resolveItemAccess } from "@/lib/permissions";
import {
  getAdjacentPublishedPosts,
  getAccessibleAllPosts,
  getAccessibleFolderCounts,
  getAccessibleFolders,
  getAllPostFiles,
  getBlog,
  getFolderCounts,
  getFolders,
  getTrashedFolders,
  getTrashedPosts,
  getPost,
  getPostById,
  getPostStoreContext,
  getPostSlugAliases,
  getDocumentTemplate,
  listDocumentTemplates,
  resolveDocumentCapability,
  resolvePostSlug,
} from "@/lib/store";
import type { Blog, Post } from "@/lib/content";
import { blogFeedAlternateTypes } from "@/lib/feed-links";
import { UnifiedDocumentReader } from "@/components/document/UnifiedDocumentReader";
import { StandaloneUnifiedDocumentEditor } from "@/components/document/StandaloneUnifiedDocumentEditor";
import { PostActionBar } from "@/components/PostActionBar";
import { PostReadWorkspaceShell } from "@/components/PostWorkspaceShell";
import { PostShortcuts } from "@/components/PostShortcuts";
import { isNoCoverValue } from "@/lib/cover";
import { postSubtitle } from "@/lib/markdown-subtitle";
import {
  blogHomePath,
  blogPostEditPath,
  blogPostPath,
} from "@/lib/public-paths";
import {
  workspacePoolFromParts,
} from "@/lib/pool/selectors";
import { workspaceWikiLinkMetadata } from "@/lib/pool/server";
import {
  WORKSPACE_SIDEBAR_COOKIE,
  parseWorkspaceSidebarCollapsed,
} from "@/lib/workspace-sidebar-state";
import { tenantFromHost } from "@/lib/tenants";
import { documentCapabilityCookieName } from "@/lib/document-capability";
import { legacyTemplateId } from "@/lib/documents/legacy";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";

interface Props {
  params: Promise<{ handle: string; slug: string }>;
  searchParams?: Promise<{ edit?: string | string[]; id?: string | string[] }>;
}
type PostPageQuery = { edit?: string | string[]; id?: string | string[] };

function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function postTitle(title: string): string {
  return title.trim() || "Untitled";
}

function postPathForRequest(
  blog: Blog,
  post: Pick<Post, "slug">,
  tenantHandle: string | null,
): string {
  return tenantHandle === blog.handle
    ? `/${encodeURIComponent(post.slug)}`
    : blogPostPath(blog, post);
}

function postEditPathForRequest(
  blog: Blog,
  post: Pick<Post, "id" | "slug">,
  tenantHandle: string | null,
): string {
  if (tenantHandle !== blog.handle) return blogPostEditPath(blog, post);
  const params = new URLSearchParams({ edit: "1" });
  if (post.id) params.set("id", post.id);
  return `/${encodeURIComponent(post.slug)}?${params.toString()}`;
}

function isEmptyOwnedPost(post: Post): boolean {
  const title = post.title.trim().toLowerCase();
  return (
    (!title || title === "untitled") &&
    !postSubtitle(post) &&
    !post.body.trim() &&
    (!post.cover?.trim() || isNoCoverValue(post.cover)) &&
    !(post.gallery && post.gallery.length > 0) &&
    !post.videoUrl?.trim()
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, slug } = await params;
  const [blog, post] = await Promise.all([
    getBlog(handle),
    getPost(handle, slug),
  ]);
  if (!blog || !post) return {};
  if (post.visibility !== "public") return {};
  const metadata: Metadata = {
    title: `${postTitle(post.title)} · ${blog.name}`,
    description:
      postSubtitle(post) || post.body.split(/\n{2,}/)[0]?.slice(0, 160),
    alternates: {
      types: blogFeedAlternateTypes(blog, blog.name),
    },
  };
  return metadata;
}

export async function PostPageForHandle({
  handle,
  redirectClaimed = true,
  searchParams,
  slug,
}: {
  handle: string;
  redirectClaimed?: boolean;
  searchParams?: Promise<PostPageQuery>;
  slug: string;
}) {
  const queryPromise: Promise<PostPageQuery> =
    searchParams ?? Promise.resolve({});
  const [blog, slugResolution, access, query, cookieStore, headerStore] =
    await Promise.all([
      getBlog(handle),
      resolvePostSlug(handle, slug),
      getBlogEditAccess(handle),
      queryPromise,
      cookies(),
      headers(),
    ]);
  if (!blog) notFound();
  const tenantHandle = tenantFromHost(headerStore.get("host"));
  const initialSidebarCollapsed = parseWorkspaceSidebarCollapsed(
    cookieStore.get(WORKSPACE_SIDEBAR_COOKIE)?.value,
  );
  const canEdit = access.canEdit;
  const editRequested = queryValue(query.edit) === "1";
  const editId = queryValue(query.id);
  let post =
    slugResolution.kind === "exact" || slugResolution.kind === "history"
      ? slugResolution.post
      : null;

  if (!post && canEdit && editRequested && editId) {
    post = await getPostById(handle, editId);
    if (post) redirect(postEditPathForRequest(blog, post, tenantHandle));
  }

  if (!post) notFound();
  const viewer = await getCurrentUser();
  const capabilityToken = post.id
    ? cookieStore.get(documentCapabilityCookieName(post.id))?.value
    : undefined;
  const capability = capabilityToken
    ? await resolveDocumentCapability(capabilityToken)
    : null;
  const capabilityAccess =
    capability && capability.itemId === post.id ? capability : null;
  const itemAccess =
    !canEdit && post.id && viewer
      ? await resolveItemAccess({ handle, postId: post.id, user: viewer })
      : null;
  const isPrivatePost = post.visibility === "private";
  if (
    isPrivatePost &&
    !canEdit &&
    !itemAccess?.canView &&
    !capabilityAccess
  ) {
    notFound();
  }
  const canEditPost =
    canEdit ||
    Boolean(itemAccess?.canEditContent) ||
    capabilityAccess?.role === "editor";
  const canCommentPost =
    canEdit ||
    Boolean(itemAccess?.canComment) ||
    capabilityAccess?.role === "editor" ||
    capabilityAccess?.role === "commenter";
  const editMode = canEditPost && editRequested;
  if (!canEdit && post.starred !== undefined) {
    post = { ...post, starred: undefined };
  }
  if (slugResolution.kind === "history") {
    const path = postPathForRequest(blog, post, tenantHandle);
    redirect(
      editMode
        ? postEditPathForRequest(blog, post, tenantHandle)
        : editRequested
          ? `${path}?edit=1`
          : path,
    );
  }
  if (redirectClaimed && blog.username && tenantHandle !== blog.handle) {
    const path = blogPostPath(blog, post);
    redirect(
      editMode
        ? blogPostEditPath(blog, post)
        : editRequested
          ? `${path}?edit=1`
          : path,
    );
  }

  const currentPostPath = postPathForRequest(blog, post, tenantHandle);
  const homePath = tenantHandle === blog.handle ? "/" : blogHomePath(blog);
  const showGuestSignIn =
    canEdit && access.isUnclaimed && access.isTokenEditor && isAuthConfigured;

  if (editMode && post.id && editId !== post.id) {
    redirect(postEditPathForRequest(blog, post, tenantHandle));
  }

  if (canEdit && !editMode && isEmptyOwnedPost(post)) {
    redirect(postEditPathForRequest(blog, post, tenantHandle));
  }

  const adjacentPromise = getAdjacentPublishedPosts(handle, post.slug);
  let allPosts: Post[];
  let folders: Awaited<ReturnType<typeof getFolders>>;
  let counts: Record<string, number>;
  let slugAliases: Record<string, string> = {};
  if (canEdit) {
    [allPosts, folders, counts, slugAliases] = await Promise.all([
      getAllPostFiles(handle),
      getFolders(handle),
      getFolderCounts(handle),
      getPostSlugAliases(handle),
    ]);
  } else {
    const [accessiblePosts, accessibleFolders] = await Promise.all([
      getAccessibleAllPosts(handle, viewer),
      getAccessibleFolders(handle, viewer),
    ]);
    allPosts = accessiblePosts;
    folders = accessibleFolders;
    counts =
      accessibleFolders.length > 0
        ? await getAccessibleFolderCounts(handle, viewer)
        : {};
  }
  const adjacent = await adjacentPromise;
  const [trashedFolders, trashedPosts] = canEdit
    ? await Promise.all([getTrashedFolders(handle), getTrashedPosts(handle)])
    : [[], []];
  const sharedEntries = canEdit ? await getSharedPostsForUser(viewer) : [];
  const workspaceTemplates =
    canEdit && access.blogId
      ? await listDocumentTemplates(access.blogId)
      : undefined;
  const initialPool =
    canEdit && access.blogId
      ? workspacePoolFromParts({
          blog,
          blogId: access.blogId,
          counts,
          folders,
          posts: allPosts,
          trashedFolders,
          trashedPosts,
          sharedEntries,
          templates: workspaceTemplates,
          ...workspaceWikiLinkMetadata(allPosts, slugAliases),
        })
      : null;
  const templateReference =
    post.template ??
    post.document?.presentation.template ?? {
      id: legacyTemplateId(post.type),
      version: 1,
    };
  const postContext = post.id ? await getPostStoreContext(post.id) : null;
  const template =
    (postContext
      ? await getDocumentTemplate(postContext.blogId, templateReference)
      : null) ??
    requireBuiltinTemplate(legacyTemplateId(post.type));

  // Any signed-in editor joins the same Yjs document; collabAccess enforces
  // the same effective item resolver on every poll and push.
  let collab: {
    postId: string;
    userName: string;
    color: string;
    canEdit: boolean;
  } | null = null;
  if (editMode && post.id) {
    const editorUser = viewer;
    if (editorUser || capabilityAccess?.role === "editor") {
      const identity = editorUser
        ? editorUser.sub
        : `capability:${capabilityAccess?.id ?? post.id}`;
      collab = {
        postId: post.id,
        userName: editorUser
          ? editorUser.name?.trim() ||
            editorUser.email?.split("@")[0] ||
            "You"
          : "Guest editor",
        color: colorForSub(identity),
        canEdit: canEditPost,
      };
    }
  }

  if (editMode) {
    if (initialPool && canEdit) {
      const reader = (
        <UnifiedDocumentReader
          blog={blog}
          post={post}
          template={template}
        />
      );
      return (
        <PostReadWorkspaceShell
          adjacent={adjacent}
          blog={blog}
          canCommentPost={canCommentPost}
          canManageFolders={canEdit}
          canManageSharing={access.isOwner}
          counts={counts}
          folders={folders}
          homePath={homePath}
          initialMode="edit"
          initialSidebarCollapsed={initialSidebarCollapsed}
          initialPool={initialPool}
          initialPostBody={
            post.id
              ? { postId: post.id, body: post.body, updatedAt: post.updatedAt }
              : null
          }
          post={post}
          postPath={currentPostPath}
          showGuestSignIn={showGuestSignIn}
        >
          {reader}
        </PostReadWorkspaceShell>
      );
    }
    if (!collab) notFound();
    return (
      <StandaloneUnifiedDocumentEditor
        key={post.id ?? post.slug}
        blog={blog}
        post={post}
        postPath={currentPostPath}
        template={template}
        collab={collab}
      />
    );
  }

  const reader = (
    <UnifiedDocumentReader
      blog={blog}
      post={post}
      template={template}
    />
  );

  return (
    <>
      {canEdit ? (
        <PostReadWorkspaceShell
          adjacent={adjacent}
          blog={blog}
          canCommentPost={canCommentPost}
          canManageFolders={canEdit}
          canManageSharing={access.isOwner}
          counts={counts}
          folders={folders}
          homePath={homePath}
          initialSidebarCollapsed={initialSidebarCollapsed}
          initialPool={initialPool}
          initialPostBody={
            post.id
              ? { postId: post.id, body: post.body, updatedAt: post.updatedAt }
              : null
          }
          post={post}
          postPath={currentPostPath}
          showGuestSignIn={showGuestSignIn}
        >
          {reader}
        </PostReadWorkspaceShell>
      ) : (
        <>
          <PostActionBar
            mode="read"
            owner={canEdit}
            blog={blog}
            post={post}
            adjacent={adjacent}
            homePath={homePath}
            postPath={currentPostPath}
            canEditPost={canEditPost}
            canManagePost={canEdit}
            canCommentPost={canCommentPost}
          />
          {reader}
        </>
      )}
      {!initialPool && (
        <PostShortcuts
          homePath={homePath}
          previousPath={
            adjacent.previous
              ? blogPostPath(blog, { slug: adjacent.previous.slug })
              : undefined
          }
          nextPath={
            adjacent.next
              ? blogPostPath(blog, { slug: adjacent.next.slug })
              : undefined
          }
          owner={canEdit}
          handle={handle}
        />
      )}
    </>
  );
}

export default async function PostPage({ params, searchParams }: Props) {
  const { handle, slug } = await params;
  return (
    <PostPageForHandle
      handle={handle}
      searchParams={searchParams}
      slug={slug}
    />
  );
}
