import type { CSSProperties } from "react";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  BlogHomeShell,
} from "@/components/BlogHomeEditorControls";
import { BlogHomeWorkspaceShell } from "@/components/PostWorkspaceShell";
import { UnifiedDocumentReader } from "@/components/document/UnifiedDocumentReader";
import { FolderPage } from "@/components/FolderPage";
import { PostCard } from "@/components/PostCard";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { getCurrentUser } from "@/lib/session";
import { getSharedPostsForUser } from "@/lib/shares";
import { resolveFolderAccess, resolveWorkspaceAccess } from "@/lib/permissions";
import {
  poolPostsForFolder,
  postFromPoolPost,
  workspacePoolFromParts,
} from "@/lib/pool/selectors";
import {
  blogAtomHref,
  blogFeedAlternateTypes,
  blogFeedHref,
  blogJsonFeedHref,
} from "@/lib/feed-links";
import {
  getAllPosts,
  getBlogEditRecord,
  getAccessibleFolderCounts,
  getAccessibleFolderPosts,
  getAccessibleFolders,
  getBlog,
  getFolderCounts,
  getFolderPosts,
  getFolders,
  getDocumentTemplate,
  getFolderCollectionLayout,
  getTrashedFolders,
  getTrashedPosts,
  getPost,
  getPostSlugAliases,
  getPostStoreContext,
  getPublicPostLocations,
  getWorkspaceWikiLinkSources,
  listDocumentTemplates,
} from "@/lib/store";
import { workspaceWikiLinkMetadata } from "@/lib/pool/server";
import {
  formatArticleDate,
  isVideoFile,
  isYouTube,
  postBodyPreview,
  postAccent,
  postReadingTimeMin,
  youtubeThumb,
} from "@/lib/content";
import type { Blog, BlogHomeLayout, Post } from "@/lib/content";
import { collectionPageLayout, plainTextExcerpt } from "@/lib/content";
import { legacyTemplateId } from "@/lib/documents/legacy";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { resolveCover } from "@/lib/cover";
import {
  blogHomePath,
  blogPostPath,
  workspacePublicBaseUrl,
  workspacePublicPostPath,
} from "@/lib/public-paths";
import { isPublicOriginRequest } from "@/lib/public-origin";
import { publicSocialMetadata } from "@/lib/public-metadata";
import { publishedPublicLocations } from "@/lib/agent-surface";
import {
  WORKSPACE_ASSISTANT_STATE_COOKIE,
  WORKSPACE_ASSISTANT_WIDTH_COOKIE,
  parseAssistantStateCookie,
  parseAssistantWidthCookie,
} from "@/lib/workspace-assistant-prefs";
import {
  WORKSPACE_SIDEBAR_COOKIE,
  parseWorkspaceSidebarCollapsed,
  WORKSPACE_SIDEBAR_WIDTH_COOKIE,
  parseWorkspaceSidebarWidth,
} from "@/lib/workspace-sidebar-state";
import {
  SHARED_FOLDER_PATH,
  STARRED_FOLDER_PATH,
  TRASH_FOLDER_PATH,
} from "@/lib/workspace-paths";

interface Props {
  params: Promise<{ handle: string }>;
  searchParams?: Promise<BlogHomeQuery>;
}

/**
 * The nine reads behind the signed-in workspace pool, issued as one parallel
 * wave. Kept as a function so the render can start it optimistically (once the
 * JWT names the owner) without waiting for the authoritative identity check.
 */
async function loadWorkspacePoolParts(
  handle: string,
  blogId: string,
  viewer: Awaited<ReturnType<typeof getCurrentUser>>,
) {
  const [
    folders,
    counts,
    posts,
    wikiLinkSources,
    slugAliases,
    trashedFolders,
    trashedPosts,
    sharedEntries,
    templates,
  ] = await Promise.all([
    getFolders(handle),
    getFolderCounts(handle),
    getAllPosts(handle),
    getWorkspaceWikiLinkSources(handle),
    getPostSlugAliases(handle),
    getTrashedFolders(handle),
    getTrashedPosts(handle),
    getSharedPostsForUser(viewer),
    listDocumentTemplates(blogId),
  ]);
  return {
    folders,
    counts,
    posts,
    wikiLinkSources,
    slugAliases,
    trashedFolders,
    trashedPosts,
    sharedEntries,
    templates,
  };
}
type BlogHomeQuery = {
  date?: string | string[];
  folder?: string | string[];
  layout?: string | string[];
  q?: string | string[];
  tag?: string | string[];
  view?: string | string[];
};


function blogStyle(blog: Blog): CSSProperties | undefined {
  return blog.accent
    ? ({ "--post-accent": blog.accent } as CSSProperties)
    : undefined;
}

function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function queryHomeLayout(value: string | undefined): BlogHomeLayout | null {
  if (
    value === "single" ||
    value === "timeline" ||
    value === "grid" ||
    value === "index"
  ) {
    return value;
  }
  return null;
}

function isDefaultBlogName(name: string): boolean {
  const normalized = name.trim().replace(/\s+/g, " ").toLowerCase();
  return (
    !normalized ||
    normalized === "untitled blog"
  );
}

function postTitle(post: Post): string {
  return post.title.trim() || "Untitled";
}

function timelineExcerpt(post: Post): string {
  return post.excerpt?.trim() || plainTextExcerpt(postBodyPreview(post));
}

function timelineMeta(post: Post): string {
  return [formatArticleDate(post.date), `${postReadingTimeMin(post)} min read`]
    .filter(Boolean)
    .join(" / ");
}

function timelineImageSrc(src: string): string {
  if (!isYouTube(src)) return src;
  return youtubeThumb(src) ?? src;
}

function postStyle(blog: Blog, post: Post): CSSProperties | undefined {
  const accent = postAccent(blog, post);
  if (accent) return { "--post-accent": accent } as CSSProperties;
  if (post.accent !== undefined) {
    return { "--post-accent": "var(--ink)" } as CSSProperties;
  }
  return undefined;
}

function BlogTimeline({
  blog,
  hrefFor,
  posts,
}: {
  blog: Blog;
  hrefFor?: (post: Post) => string;
  posts: Post[];
}) {
  return (
    <div className="blog-timeline" aria-label="Posts">
      {posts.map((post) => {
        const title = postTitle(post);
        const cover = resolveCover(post);
        const meta = timelineMeta(post);
        const excerpt = timelineExcerpt(post);
        const thumbnail = cover ? timelineImageSrc(cover) : "";

        return (
          <Link
            key={post.slug}
            className={`blog-timeline-row${thumbnail ? "" : " is-no-thumb"}`}
            href={hrefFor ? hrefFor(post) : blogPostPath(blog, post)}
            prefetch={true}
            style={postStyle(blog, post)}
          >
            <span className="blog-timeline-copy">
              <span className="blog-timeline-chip-row">
                {post.pinned && (
                  <span className="blog-timeline-marker">Pinned</span>
                )}
              </span>
              <span className="blog-timeline-title">{title}</span>
              <span className="blog-timeline-meta">{meta}</span>
              {excerpt && (
                <span className="blog-timeline-excerpt">{excerpt}</span>
              )}
            </span>
            {thumbnail && (
              <span className="blog-timeline-thumb" aria-hidden="true">
                {isVideoFile(cover) ? (
                  <video
                    className="blog-timeline-thumb-media"
                    src={cover}
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  // User media can be remote, so plain img avoids next/image config.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="blog-timeline-thumb-media"
                    src={thumbnail}
                    alt=""
                    decoding="async"
                    loading="lazy"
                  />
                )}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function BlogIndex({
  blog,
  hrefFor,
  posts,
}: {
  blog: Blog;
  hrefFor?: (post: Post) => string;
  posts: Post[];
}) {
  return (
    <div className="blog-index-list" aria-label="Posts">
      {posts.map((post) => {
        return (
          <Link
            key={post.slug}
            className="blog-index-row"
            href={hrefFor ? hrefFor(post) : blogPostPath(blog, post)}
            prefetch={true}
            style={postStyle(blog, post)}
          >
            <span className="blog-index-title">{postTitle(post)}</span>
            <span className="blog-index-meta">
              {formatArticleDate(post.date)}
              {post.pinned ? " / Pinned" : ""}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function BlogSingleHome({
  blog,
  post,
  template,
}: {
  blog: Blog;
  post: Post;
  template: TemplateDefinition;
}) {
  return (
    <div className="blog-single-home">
      <UnifiedDocumentReader blog={blog} post={post} template={template} />
    </div>
  );
}

/**
 * The empty state a VISITOR sees. The call site renders this only when the
 * viewer cannot edit, so it is never the owner reading it, and the copy used to
 * address the owner anyway: it told a stranger to add the first item to a
 * collection that is not theirs. It also read as though the workspace were
 * empty, when the ordinary cause is simply that nothing here is published.
 */
function BlogEmptyState({ layout }: { layout: BlogHomeLayout }) {
  // Every layout says something. Timeline used to return null, which left a
  // visitor on a page with a name and nothing under it, indistinguishable
  // from a page that failed to load.
  const copy =
    layout === "single"
      ? "Nothing published here yet."
      : layout === "index"
        ? "No pages published in this index yet."
        : layout === "timeline"
          ? "Nothing published in this timeline yet."
          : "Nothing published in this collection yet.";

  return <p className="blog-home-empty">{copy}</p>;
}

function WorkspaceRootLanding({ blog }: { blog: Blog }) {
  return (
    <main className="workspace-root-page" aria-labelledby="workspace-root-title">
      <div className="workspace-root-inner">
        <span className="workspace-root-eyebrow">Workspace</span>
        <h1 id="workspace-root-title">{blog.name}</h1>
        <p>Open Blog to start writing.</p>
      </div>
    </main>
  );
}

async function PublicBlogHome({ blog }: { blog: Blog }) {
  const layout = collectionPageLayout(
    await getFolderCollectionLayout(blog.handle, "blog"),
  );
  const locations = publishedPublicLocations(
    await getPublicPostLocations(blog.handle),
  );
  const posts = locations.map((location) => location.post);
  const pathByPost = new Map(
    locations.map((location) => [
      location.post,
      workspacePublicPostPath(location.folderPath, location.post.slug),
    ]),
  );
  const hrefFor = (post: Post): string =>
    pathByPost.get(post) ?? "/";
  const singlePost = posts[0];
  const singleContext = singlePost?.id
    ? await getPostStoreContext(singlePost.id)
    : null;
  const singleReference = singlePost
    ? singlePost.template ??
      singlePost.document?.presentation.template ?? {
        id: legacyTemplateId(singlePost.type),
        version: 1,
      }
    : null;
  const singleTemplate = singlePost
    ? (singleContext && singleReference
        ? await getDocumentTemplate(singleContext.blogId, singleReference)
        : null) ?? requireBuiltinTemplate(legacyTemplateId(singlePost.type))
    : null;
  const feedLinks = [
    { href: "/feed.xml", label: "RSS" },
    { href: "/atom.xml", label: "Atom" },
    { href: "/feed.json", label: "JSON Feed" },
  ];

  return (
    <BlogHomeShell
      handle={blog.handle}
      blogName={blog.name}
      initialName={blog.name}
      tagline={blog.tagline}
      canEdit={false}
      publicPath="/"
      initialNamingCeremony={false}
      style={blogStyle(blog)}
    >
      {posts.length === 0 ? <BlogEmptyState layout={layout} /> : null}
      {singlePost && singleTemplate && layout === "single" ? (
        <BlogSingleHome blog={blog} post={singlePost} template={singleTemplate} />
      ) : null}
      {posts.length > 0 && layout === "timeline" ? (
        <BlogTimeline blog={blog} posts={posts} hrefFor={hrefFor} />
      ) : null}
      {posts.length > 0 && layout === "grid" ? (
        <div className="tv-grid">
          {locations.map(({ folderPath, post }) => (
            <PostCard
              key={post.id ?? `${folderPath}/${post.slug}`}
              blog={blog}
              handle={blog.handle}
              href={hrefFor(post)}
              post={post}
              owner={false}
              categoryLabel={folderPath.split("/").at(-1) ?? null}
              tagBasePath="/tags"
              showTypeChip={false}
            />
          ))}
        </div>
      ) : null}
      {posts.length > 0 && layout === "index" ? (
        <BlogIndex blog={blog} posts={posts} hrefFor={hrefFor} />
      ) : null}
      {posts.length > 0 ? (
        <footer className="blog-home-footer" aria-label="Feeds">
          <span className="blog-home-footer-label">Feeds</span>
          {feedLinks.map((feed) => (
            <Link
              key={feed.href}
              className="blog-home-footer-link"
              href={feed.href}
              aria-label={`${blog.name} ${feed.label} feed`}
            >
              {feed.label}
            </Link>
          ))}
        </footer>
      ) : null}
    </BlogHomeShell>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const blog = await getBlog(handle);
  if (!blog) return {};
  const publicBaseUrl = workspacePublicBaseUrl(handle);
  return {
    title: blog.name,
    description: blog.tagline,
    alternates: {
      canonical: publicBaseUrl,
      types: blogFeedAlternateTypes(blog, blog.name),
    },
    ...publicSocialMetadata({
      title: blog.name,
      description: blog.tagline,
      url: publicBaseUrl,
      imageUrl: `${publicBaseUrl}/opengraph-image`,
    }),
  };
}

export async function BlogHomeForHandle({
  handle,
  redirectClaimed = true,
  searchParams,
}: {
  handle: string;
  redirectClaimed?: boolean;
  searchParams?: Promise<BlogHomeQuery>;
}) {
  const queryPromise: Promise<BlogHomeQuery> =
    searchParams ?? Promise.resolve({});
  const accessPromise = getBlogEditAccess(handle);
  const [blog, query, cookieStore, viewer, editRecord] = await Promise.all([
    getBlog(handle),
    queryPromise,
    cookies(),
    getCurrentUser(),
    getBlogEditRecord(handle),
  ]);
  if (!blog) notFound();
  // Fire the workspace pool while the authoritative identity check inside
  // getBlogEditAccess is still in flight. The JWT's embedded userId names the
  // owner in the ordinary case; if the identity table disagrees, the result is
  // discarded below and nothing from it renders.
  const optimisticPoolParts =
    editRecord?.ownerId && viewer?.userId === editRecord.ownerId
      ? loadWorkspacePoolParts(handle, editRecord.id, viewer)
      : null;
  // A discarded optimistic fetch must not surface as an unhandled rejection.
  optimisticPoolParts?.catch(() => {});
  const access = await accessPromise;
  // The owner needs no collaborator-grant resolution: every place the result
  // is consulted short-circuits on ownership.
  const workspaceAccess =
    viewer && !access.isOwner
      ? await resolveWorkspaceAccess({ handle, user: viewer })
      : null;
  if (!access.canEdit && !workspaceAccess?.canView) {
    redirect(workspacePublicBaseUrl(handle));
  }
  // The desktop app tags its web view with this cookie (set natively before
  // the first request). It drops you straight into the workspace, so the
  // folder sidebar starts OPEN there unless you've explicitly collapsed it,
  // and the feeds footer is chrome the app doesn't need.
  const inTextTextApp = cookieStore.get("wr_app")?.value === "1";
  const sidebarCookie = cookieStore.get(WORKSPACE_SIDEBAR_COOKIE)?.value;
  const initialSidebarCollapsed = parseWorkspaceSidebarCollapsed(sidebarCookie);
  // First paint of the assistant rail matches what this browser last
  // resolved, so opening a document never pops the rail in afterwards.
  const initialAssistantState =
    parseAssistantStateCookie(
      cookieStore.get(WORKSPACE_ASSISTANT_STATE_COOKIE)?.value,
    ) ?? undefined;
  const initialAssistantWidth =
    parseAssistantWidthCookie(
      cookieStore.get(WORKSPACE_ASSISTANT_WIDTH_COOKIE)?.value,
    ) ?? undefined;
  const initialSidebarWidth = parseWorkspaceSidebarWidth(
    cookieStore.get(WORKSPACE_SIDEBAR_WIDTH_COOKIE)?.value,
  );
  if (redirectClaimed && blog.username) {
    const redirectParams = new URLSearchParams();
    for (const key of [
      "date",
      "folder",
      "layout",
      "q",
      "tag",
      "view",
    ] as const) {
      const value = queryValue(query[key]);
      if (value) redirectParams.set(key, value);
    }
    const suffix = redirectParams.toString()
      ? `?${redirectParams.toString()}`
      : "";
    redirect(`${blogHomePath(blog)}${suffix}`);
  }
  const canEdit = access.canEdit;
  const initialPool = await (async () => {
    if (!canEdit || !access.blogId) return null;
    const parts = await (optimisticPoolParts ??
      loadWorkspacePoolParts(handle, access.blogId, viewer));
    return workspacePoolFromParts({
      blog,
      blogId: access.blogId,
      folders: parts.folders,
      counts: parts.counts,
      posts: parts.posts,
      trashedFolders: parts.trashedFolders,
      trashedPosts: parts.trashedPosts,
      sharedEntries: parts.sharedEntries,
      templates: parts.templates,
      ...workspaceWikiLinkMetadata(parts.wikiLinkSources, parts.slugAliases),
    });
  })();
  const canManageSharing = access.isOwner || Boolean(workspaceAccess?.canManage);
  const hasBlogWorkspaceContent =
    canEdit || Boolean(workspaceAccess?.canEditContent);
  // ?layout= previews a page layout without saving it, for everyone. What
  // persists is the look on the folder.
  const previewHomeLayout = queryHomeLayout(queryValue(query.layout));
  const layout =
    previewHomeLayout ??
    collectionPageLayout(await getFolderCollectionLayout(handle, "blog"));
  // The blog home lists ONLY the Blog folder: notes and bookmarks live in
  // their own folder views and never mix into the cards, even for the owner.
  const [posts, folders, counts] = initialPool
    ? [
        poolPostsForFolder(initialPool, "blog").map((post) =>
          postFromPoolPost(post),
        ),
        initialPool.folders,
        initialPool.counts,
      ] as const
    : await Promise.all([
        getFolderPosts(handle, "blog", {
          publishedOnly: !hasBlogWorkspaceContent,
        }),
        canEdit
          ? getFolders(handle)
          : getAccessibleFolders(handle, viewer),
        canEdit
          ? getFolderCounts(handle)
          : getAccessibleFolderCounts(handle, viewer),
      ]);
  // Category chip source: a blog SUBFOLDER (has a slash in its path) a post
  // is filed under. The root "blog" folder is not a category, so it is
  // omitted. Only populated for the owner (folders loads only then).
  const categoryNameByFolderId = new Map(
    folders
      .filter((folder) => folder.mode === "blog" && folder.path.includes("/"))
      .map((folder) => [folder.id, folder.name]),
  );
  const categoryLabelFor = (post: (typeof posts)[number]): string | null =>
    post.folderId ? categoryNameByFolderId.get(post.folderId) ?? null : null;
  // A non-blog ?folder= opens that folder's workspace view. Guests only get
  // folders returned by getAccessibleFolders, so no other workspace content
  // leaks through this route.
  const requestedFolder = queryValue(query.folder);
  const activeFolder = requestedFolder
    ? folders.find((folder) => folder.path === requestedFolder) ?? null
    : null;
  const activeSpecialFolder =
    requestedFolder === TRASH_FOLDER_PATH ||
    requestedFolder === SHARED_FOLDER_PATH ||
    requestedFolder === STARRED_FOLDER_PATH
      ? requestedFolder
      : null;
  const folderItemsPromise = activeFolder
    ? initialPool
      ? Promise.resolve(
          poolPostsForFolder(initialPool, activeFolder.path).map((post) =>
            postFromPoolPost(post),
          ),
        )
      : canEdit
        ? getFolderPosts(handle, activeFolder.path)
        : getAccessibleFolderPosts(handle, activeFolder.path, viewer)
    : Promise.resolve<Post[]>([]);
  const activeFolderAccessPromise =
    activeFolder && !canEdit
      ? resolveFolderAccess({
          handle,
          folderId: activeFolder.id,
          user: viewer,
        })
      : Promise.resolve(null);
  const [folderItems, activeFolderAccess] = await Promise.all([
    folderItemsPromise,
    activeFolderAccessPromise,
  ]);
  // The single layout leads with the newest published post; an owner's
  // unpublished drafts never displace what visitors see.
  const singlePost = initialPool
    ? undefined
    : posts.find((post) => post.status === "published") ?? posts[0];
  const singleReaderPostRaw =
    singlePost && layout === "single"
      ? (await getPost(handle, singlePost.slug)) ?? singlePost
      : singlePost;
  // `starred` is personal metadata; never expose it to a non-owner (matches the
  // explicit strip on the standalone /[slug] page). No leak today, but keep the
  // guarantee explicit rather than relying on the reader not emitting it.
  const singleReaderPost =
    singleReaderPostRaw && !canEdit
      ? { ...singleReaderPostRaw, starred: undefined }
      : singleReaderPostRaw;
  const singleReaderTemplate = singleReaderPost
    ? (access.blogId
        ? await getDocumentTemplate(
            access.blogId,
            singleReaderPost.template ??
              singleReaderPost.document?.presentation.template ?? {
                id: legacyTemplateId(singleReaderPost.type),
                version: 1,
              },
          )
        : null) ?? requireBuiltinTemplate(legacyTemplateId(singleReaderPost.type))
    : null;
  const feedHref = blogFeedHref(blog);
  const isUnnamedBlog = isDefaultBlogName(blog.name);
  const editableBlogName = isUnnamedBlog ? "" : blog.name;
  const showNamingCeremony = canEdit && isUnnamedBlog;
  const feedLinks = [
    { href: feedHref, label: "RSS" },
    { href: blogAtomHref(blog), label: "Atom" },
    { href: blogJsonFeedHref(blog), label: "JSON Feed" },
  ];

  const home = (
    <BlogHomeShell
      handle={handle}
      blogName={blog.name}
      initialName={editableBlogName}
      tagline={blog.tagline}
      canEdit={canEdit}
      publicPath={blogHomePath(blog)}
      initialNamingCeremony={showNamingCeremony}
      style={blogStyle(blog)}
    >
      {posts.length === 0 && !canEdit && (
        <BlogEmptyState layout={layout} />
      )}

      {singleReaderPost && singleReaderTemplate && layout === "single" && (
        <BlogSingleHome
          blog={blog}
          post={singleReaderPost}
          template={singleReaderTemplate}
        />
      )}

      {posts.length > 0 && layout === "timeline" && (
        <BlogTimeline
          blog={blog}
          posts={posts}
        />
      )}

      {posts.length > 0 && layout === "grid" && (
        <div className="tv-grid">
          {posts.map((post) => (
            <PostCard
              key={post.slug}
              blog={blog}
              handle={handle}
              post={post}
              owner={canEdit}
              categoryLabel={categoryLabelFor(post)}
              showTypeChip={false}
            />
          ))}
        </div>
      )}

      {posts.length > 0 && layout === "index" && (
        <BlogIndex blog={blog} posts={posts} />
      )}

      {posts.length > 0 && !inTextTextApp && (
        <footer className="blog-home-footer" aria-label="Feeds">
          <span className="blog-home-footer-label">Feeds</span>
          {feedLinks.map((feed) => (
            <Link
              key={feed.href}
              className="blog-home-footer-link"
              href={feed.href}
              aria-label={`${blog.name} ${feed.label} feed`}
            >
              {feed.label}
            </Link>
          ))}
        </footer>
      )}
    </BlogHomeShell>
  );

  const showWorkspaceShell =
    canEdit || hasBlogWorkspaceContent || folders.length > 0;

  return showWorkspaceShell ? (
    <BlogHomeWorkspaceShell
      blog={blog}
      activeFolder={activeFolder?.path ?? activeSpecialFolder}
      canCommentPost={Boolean(viewer && canEdit)}
      canManageFolders={canEdit}
      canManageSharing={canManageSharing}
      counts={counts}
      folders={folders}
      homePath={blogHomePath(blog)}
      initialSidebarCollapsed={initialSidebarCollapsed}
      initialAssistantState={initialAssistantState}
      initialAssistantWidth={initialAssistantWidth}
      initialSidebarWidth={initialSidebarWidth}
      initialSearchQuery={
        queryValue(query.date) ??
        queryValue(query.tag) ??
        queryValue(query.q) ??
        ""
      }
      initialSearchSource={
        queryValue(query.date)
          ? "date"
          : queryValue(query.tag)
            ? "tag"
            : "query"
      }
      initialSettingsOpen={queryValue(query.view) === "settings"}
      initialPool={initialPool}
    >
      {activeFolder ? (
        <FolderPage
          blog={blog}
          folder={activeFolder}
          handle={handle}
          items={folderItems}
          canCreateItems={canEdit}
          canEditItems={
            !initialPool && (canEdit || Boolean(activeFolderAccess?.canEditContent))
          }
        />
      ) : initialPool ? (
        <WorkspaceRootLanding blog={blog} />
      ) : (
        home
      )}
    </BlogHomeWorkspaceShell>
  ) : (
    home
  );
}

export default async function BlogHome({ params, searchParams }: Props) {
  const { handle } = await params;
  const headerStore = await headers();
  if (isPublicOriginRequest(headerStore)) {
    const blog = await getBlog(handle);
    if (!blog) notFound();
    return <PublicBlogHome blog={blog} />;
  }
  return <BlogHomeForHandle handle={handle} searchParams={searchParams} />;
}
