import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
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
  getAllPosts,
  getBlog,
  getFolderCounts,
  getFolderById,
  getFolders,
  getTrashedFolders,
  getTrashedPosts,
  getPosts,
  getPostById,
  getPostByFolderPath,
  getPostStoreContext,
  getPostSlugAliases,
  getWorkspaceWikiLinkSources,
  getDocumentTemplate,
  listDocumentTemplates,
  resolveDocumentCapability,
  resolveLegacyPublicSlug,
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
  blogWorkspacePostEditPath,
  blogWorkspacePostPath,
  platformReportUrl,
  workspacePublicPostUrl,
} from "@/lib/public-paths";
import {
  workspacePoolFromParts,
} from "@/lib/pool/selectors";
import { workspaceWikiLinkMetadata } from "@/lib/pool/server";
import {
  extractWikiLinks,
  publicWikiLinkRenderTargets,
} from "@/lib/wikilinks";
import {
  WORKSPACE_SIDEBAR_COOKIE,
  parseWorkspaceSidebarCollapsed,
} from "@/lib/workspace-sidebar-state";
import { tenantFromHost } from "@/lib/tenants";
import { documentCapabilityCookieName } from "@/lib/document-capability";
import { legacyTemplateId } from "@/lib/documents/legacy";
import { requireDocumentSnapshot } from "@/lib/documents/model";
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
  folderPath?: string,
): string {
  if (folderPath && tenantHandle !== blog.handle) {
    return blogWorkspacePostPath(blog, folderPath, post);
  }
  return tenantHandle === blog.handle
    ? `/${encodeURIComponent(post.slug)}`
    : blogPostPath(blog, post);
}

function postEditPathForRequest(
  blog: Blog,
  post: Pick<Post, "id" | "slug">,
  tenantHandle: string | null,
  folderPath?: string,
): string {
  if (folderPath && tenantHandle !== blog.handle) {
    return blogWorkspacePostEditPath(blog, folderPath, post);
  }
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
  const [blog, resolution] = await Promise.all([
    getBlog(handle),
    resolveLegacyPublicSlug(handle, slug),
  ]);
  if (!blog || resolution.kind !== "redirect") return {};
  const post = resolution.post;
  const canonical = workspacePublicPostUrl(
    handle,
    resolution.folderPath,
    post.slug,
  );
  const metadata: Metadata = {
    title: `${postTitle(post.title)} · ${blog.name}`,
    description:
      postSubtitle(post) || post.body.split(/\n{2,}/)[0]?.slice(0, 160),
    alternates: {
      canonical: canonical ?? undefined,
      types: blogFeedAlternateTypes(blog, blog.name),
    },
  };
  return metadata;
}

export async function PostPageForHandle({
  handle,
  redirectClaimed = true,
  canonicalUsernameRoute = false,
  searchParams,
  slug,
  folderPath,
}: {
  handle: string;
  redirectClaimed?: boolean;
  searchParams?: Promise<PostPageQuery>;
  slug: string;
  folderPath?: string;
  /** The /@username alias is already canonical; never bounce it through /t. */
  canonicalUsernameRoute?: boolean;
}) {
  const queryPromise: Promise<PostPageQuery> =
    searchParams ?? Promise.resolve({});
  const query = await queryPromise;
  const legacyPublicRequest =
    !canonicalUsernameRoute && !folderPath && queryValue(query.edit) !== "1";
  if (legacyPublicRequest) {
    const legacy = await resolveLegacyPublicSlug(handle, slug);
    if (legacy.kind === "redirect") {
      const destination = workspacePublicPostUrl(
        handle,
        legacy.folderPath,
        legacy.post.slug,
      );
      if (destination) redirect(destination);
    }
  }
  const [blog, slugResolution, access, cookieStore, headerStore] =
    await Promise.all([
      getBlog(handle),
      folderPath
        ? getPostByFolderPath(handle, folderPath, slug).then((post) =>
            post ? ({ kind: "exact", post } as const) : ({ kind: "missing" } as const),
          )
        : resolvePostSlug(handle, slug),
      getBlogEditAccess(handle),
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
  let activeFolderPath = folderPath;

  if (canEdit && editRequested && editId) {
    const postById = await getPostById(handle, editId);
    if (postById) {
      post = postById;
      const actualFolder = post.folderId
        ? await getFolderById(handle, post.folderId)
        : null;
      activeFolderPath = actualFolder?.path ?? activeFolderPath;
      if (post.slug !== slug || activeFolderPath !== folderPath) {
        if (!canonicalUsernameRoute) {
          redirect(
            postEditPathForRequest(
              blog,
              post,
              tenantHandle,
              activeFolderPath,
            ),
          );
        }
      }
    }
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
  if (
    legacyPublicRequest &&
    !canEdit &&
    !itemAccess?.canView &&
    !capabilityAccess
  ) {
    notFound();
  }
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
    const path = postPathForRequest(blog, post, tenantHandle, activeFolderPath);
    if (!canonicalUsernameRoute) {
      redirect(
        editMode
          ? postEditPathForRequest(blog, post, tenantHandle, activeFolderPath)
          : editRequested
            ? `${path}?edit=1`
            : path,
      );
    }
  }
  if (redirectClaimed && blog.username && tenantHandle !== blog.handle) {
    const path = blogPostPath(blog, post);
    if (!canonicalUsernameRoute) {
      redirect(
        editMode
          ? blogPostEditPath(blog, post)
          : editRequested
            ? `${path}?edit=1`
            : path,
      );
    }
  }

  const currentPostPath = postPathForRequest(
    blog,
    post,
    tenantHandle,
    activeFolderPath,
  );
  const homePath = tenantHandle === blog.handle ? "/" : blogHomePath(blog);

  if (editMode && post.id && editId !== post.id) {
    if (!canonicalUsernameRoute) {
      redirect(postEditPathForRequest(blog, post, tenantHandle, activeFolderPath));
    }
  }

  if (canEdit && !editMode && isEmptyOwnedPost(post)) {
    if (!canonicalUsernameRoute) {
      redirect(postEditPathForRequest(blog, post, tenantHandle, activeFolderPath));
    }
  }

  const adjacentPromise = getAdjacentPublishedPosts(handle, post.id ?? post.slug);
  let allPosts: Post[];
  let folders: Awaited<ReturnType<typeof getFolders>>;
  let counts: Record<string, number>;
  let slugAliases: Record<string, string> = {};
  let wikiLinkSources: Awaited<ReturnType<typeof getWorkspaceWikiLinkSources>> = [];
  if (canEdit) {
    [allPosts, folders, counts, slugAliases, wikiLinkSources] = await Promise.all([
      getAllPosts(handle),
      getFolders(handle),
      getFolderCounts(handle),
      getPostSlugAliases(handle),
      getWorkspaceWikiLinkSources(handle),
    ]);
  } else {
    const [accessiblePosts, accessibleFolders, accessibleAliases] =
      await Promise.all([
        getAccessibleAllPosts(handle, viewer),
        getAccessibleFolders(handle, viewer),
        getPostSlugAliases(handle),
      ]);
    allPosts = accessiblePosts;
    folders = accessibleFolders;
    slugAliases = accessibleAliases;
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
          ...workspaceWikiLinkMetadata(wikiLinkSources, slugAliases),
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
  const initialPostDocument = post.id
    ? {
        postId: post.id,
        document: requireDocumentSnapshot(post.document, `Post ${post.id}`),
        revision: post.revision,
        updatedAt: post.updatedAt,
      }
    : null;

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
          initialPostDocument={initialPostDocument}
          post={post}
          postPath={currentPostPath}
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

  // Public wiki links: targets come only from the same published-public feed
  // the blog lists, plus aliases that resolve to a post in that feed. Anything
  // else fails closed and renders as plain text.
  const wikiLinkTargets = !canEdit
    ? publicWikiLinkRenderTargets({
        blog,
        posts: await getPosts(handle),
        slugAliases,
      })
    : undefined;

  const reader = (
    <UnifiedDocumentReader
      blog={blog}
      post={post}
      template={template}
      wikiLinkTargets={wikiLinkTargets}
    />
  );

  // Public "Linked from": sourced from the same published-public feed the
  // blog itself lists, so nothing private can ever appear here. The
  // workspace shell computes its own richer panel from the pool.
  const publicBacklinks = !canEdit
    ? (await getPosts(handle))
        .filter((source) => {
          if (source.slug === post.slug) return false;
          return extractWikiLinks(source.body ?? "").some(
            (link) =>
              link.target === post.slug ||
              slugAliases[link.target] === post.slug,
          );
        })
        .slice(0, 12)
    : [];

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
          initialPostDocument={initialPostDocument}
          post={post}
          postPath={currentPostPath}
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
          {/* Guideline 1.2 and plain decency: anyone who can read a published
              page can say it should not be here, without an account. */}
          <footer className="public-report-footer">
            <a
              href={platformReportUrl(currentPostPath, post.id)}
              rel="nofollow"
            >
              Report this page
            </a>
          </footer>
          {publicBacklinks.length > 0 ? (
            <aside className="backlinks-panel is-public" aria-label="Linked from">
              <h2>Linked from</h2>
              <nav aria-label="Backlinks">
                {publicBacklinks.map((source) => (
                  <a key={source.id ?? source.slug} href={blogPostPath(blog, source)}>
                    <span>{source.title.trim() || "Untitled"}</span>
                    <small>{source.slug}</small>
                  </a>
                ))}
              </nav>
            </aside>
          ) : null}
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
