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
import { isAuthConfigured } from "@/auth";
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
  DEFAULT_ANONYMOUS_BLOG_NAME,
  getAllPostFiles,
  getAccessibleFolderCounts,
  getAccessibleFolderPosts,
  getAccessibleFolders,
  getBlog,
  getFolderCounts,
  getFolderPosts,
  getFolders,
  getDocumentTemplate,
  getTrashedFolders,
  getTrashedPosts,
  getPost,
  getPostSlugAliases,
  getPostStoreContext,
  getPublicPostLocations,
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
import type { Blog, BlogCardStyle, BlogHomeLayout, Post } from "@/lib/content";
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
  WORKSPACE_SIDEBAR_COOKIE,
  parseWorkspaceSidebarCollapsed,
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
type BlogHomeQuery = {
  card?: string | string[];
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

function queryCardStyle(value: string | undefined): BlogCardStyle | null {
  if (value === "cover" || value === "minimal") return value;
  return null;
}

function isDefaultBlogName(name: string): boolean {
  const normalized = name.trim().replace(/\s+/g, " ").toLowerCase();
  return (
    !normalized ||
    normalized === DEFAULT_ANONYMOUS_BLOG_NAME.toLowerCase()
  );
}

function postTitle(post: Post): string {
  return post.title.trim() || "Untitled";
}

function oneLine(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const sliced = value.slice(0, maxLength - 3).trimEnd();
  const wordBreak = sliced.lastIndexOf(" ");
  const base = wordBreak > 70 ? sliced.slice(0, wordBreak) : sliced;
  return `${base}...`;
}

function plainTextExcerpt(markdown: string | undefined): string {
  if (!markdown) return "";
  return truncate(oneLine(stripMarkdown(markdown)), 180);
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
function BlogEmptyState({ layout }: { layout: Blog["homeLayout"] }) {
  if (layout === "timeline") return null;

  const copy =
    layout === "single"
      ? "Nothing published here yet."
      : layout === "index"
        ? "No pages published in this index yet."
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
      isGuestWorkspace={false}
      authConfigured={false}
      publicPath="/"
      initialCardStyle={blog.cardStyle}
      initialHomeLayout={blog.homeLayout}
      initialNamingCeremony={false}
      style={blogStyle(blog)}
    >
      {posts.length === 0 ? <BlogEmptyState layout={blog.homeLayout} /> : null}
      {singlePost && singleTemplate && blog.homeLayout === "single" ? (
        <BlogSingleHome blog={blog} post={singlePost} template={singleTemplate} />
      ) : null}
      {posts.length > 0 && blog.homeLayout === "timeline" ? (
        <BlogTimeline blog={blog} posts={posts} hrefFor={hrefFor} />
      ) : null}
      {posts.length > 0 && blog.homeLayout === "grid" ? (
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
      {posts.length > 0 && blog.homeLayout === "index" ? (
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
  const [blog, access, query, cookieStore, viewer] = await Promise.all([
    getBlog(handle),
    getBlogEditAccess(handle),
    queryPromise,
    cookies(),
    getCurrentUser(),
  ]);
  if (!blog) notFound();
  const workspaceAccess = viewer
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
  if (redirectClaimed && blog.username) {
    const redirectParams = new URLSearchParams();
    for (const key of [
      "card",
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
    const [
      folders,
      counts,
      posts,
      slugAliases,
      trashedFolders,
      trashedPosts,
      sharedEntries,
      templates,
    ] =
      await Promise.all([
        getFolders(handle),
        getFolderCounts(handle),
        getAllPostFiles(handle),
        getPostSlugAliases(handle),
        getTrashedFolders(handle),
        getTrashedPosts(handle),
        getSharedPostsForUser(viewer),
        listDocumentTemplates(access.blogId),
      ]);
    return workspacePoolFromParts({
      blog,
      blogId: access.blogId,
      folders,
      counts,
      posts,
      trashedFolders,
      trashedPosts,
      sharedEntries,
      templates,
      ...workspaceWikiLinkMetadata(posts, slugAliases),
    });
  })();
  const canManageSharing = access.isOwner || Boolean(workspaceAccess?.canManage);
  const hasBlogWorkspaceContent =
    canEdit || Boolean(workspaceAccess?.canEditContent);
  // ?layout= and ?card= preview a look without saving it, for everyone; the
  // editor's Layout popover is what persists a choice.
  const previewHomeLayout = queryHomeLayout(queryValue(query.layout));
  const previewCardStyle = queryCardStyle(queryValue(query.card));
  const displayBlog: Blog =
    previewHomeLayout || previewCardStyle
      ? {
          ...blog,
          cardStyle: previewCardStyle ?? blog.cardStyle,
          homeLayout: previewHomeLayout ?? blog.homeLayout,
        }
      : blog;
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
    singlePost && displayBlog.homeLayout === "single"
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
  const isGuestWorkspace =
    canEdit && access.isUnclaimed && access.isTokenEditor;
  const feedLinks = [
    { href: feedHref, label: "RSS" },
    { href: blogAtomHref(blog), label: "Atom" },
    { href: blogJsonFeedHref(blog), label: "JSON Feed" },
  ];

  const home = (
    <BlogHomeShell
      handle={handle}
      blogName={displayBlog.name}
      initialName={editableBlogName}
      tagline={displayBlog.tagline}
      canEdit={canEdit}
      isGuestWorkspace={isGuestWorkspace}
      authConfigured={isAuthConfigured}
      publicPath={blogHomePath(blog)}
      initialCardStyle={blog.cardStyle}
      initialHomeLayout={blog.homeLayout}
      initialNamingCeremony={showNamingCeremony}
      style={blogStyle(displayBlog)}
    >
      {posts.length === 0 && !canEdit && (
        <BlogEmptyState layout={displayBlog.homeLayout} />
      )}

      {singleReaderPost && singleReaderTemplate && displayBlog.homeLayout === "single" && (
        <BlogSingleHome
          blog={displayBlog}
          post={singleReaderPost}
          template={singleReaderTemplate}
        />
      )}

      {posts.length > 0 && displayBlog.homeLayout === "timeline" && (
        <BlogTimeline
          blog={displayBlog}
          posts={posts}
        />
      )}

      {posts.length > 0 && displayBlog.homeLayout === "grid" && (
        <div className="tv-grid">
          {posts.map((post) => (
            <PostCard
              key={post.slug}
              blog={displayBlog}
              handle={handle}
              post={post}
              owner={canEdit}
              categoryLabel={categoryLabelFor(post)}
              showTypeChip={false}
            />
          ))}
        </div>
      )}

      {posts.length > 0 && displayBlog.homeLayout === "index" && (
        <BlogIndex blog={displayBlog} posts={posts} />
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
      showGuestSignIn={isGuestWorkspace && isAuthConfigured}
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
