import type { CSSProperties } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  BlogHomeShell,
} from "@/components/BlogHomeEditorControls";
import { BlogHomeWorkspaceShell } from "@/components/PostWorkspaceShell";
import { FolderPage } from "@/components/FolderPage";
import { PostCard } from "@/components/PostCard";
import { ProjectReader } from "@/components/ProjectReader";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";
import { isAuthConfigured } from "@/auth";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { getCurrentUser } from "@/lib/session";
import { resolveFolderAccess, resolveWorkspaceAccess } from "@/lib/permissions";
import {
  blogAtomHref,
  blogFeedAlternateTypes,
  blogFeedHref,
  blogJsonFeedHref,
} from "@/lib/feed-links";
import {
  DEFAULT_ANONYMOUS_BLOG_NAME,
  getAccessibleFolderCounts,
  getAccessibleFolderPosts,
  getAccessibleFolders,
  getBlog,
  getFolderCounts,
  getFolderPosts,
  getFolders,
} from "@/lib/store";
import {
  formatArticleDate,
  isVideoFile,
  isYouTube,
  postAccent,
  readingTimeMin,
  youtubeThumb,
} from "@/lib/content";
import type { Blog, BlogCardStyle, BlogHomeLayout, Post, PostType } from "@/lib/content";
import { resolveCover } from "@/lib/cover";
import { blogHomePath, blogPostPath } from "@/lib/public-paths";
import {
  WORKSPACE_SIDEBAR_COOKIE,
  parseWorkspaceSidebarCollapsed,
} from "@/lib/workspace-sidebar-state";

interface Props {
  params: Promise<{ handle: string }>;
  searchParams?: Promise<BlogHomeQuery>;
}
type BlogHomeQuery = {
  card?: string | string[];
  folder?: string | string[];
  layout?: string | string[];
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

const TYPE_LABELS: Record<PostType, string> = {
  article: "Article",
  project: "Media",
  talk: "Video",
  note: "Note",
  bookmark: "Bookmark",
};

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
  return post.excerpt?.trim() || plainTextExcerpt(post.body);
}

function timelineMeta(post: Post): string {
  return [formatArticleDate(post.date), `${readingTimeMin(post.body)} min read`]
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
  posts,
  owner,
}: {
  blog: Blog;
  posts: Post[];
  owner: boolean;
}) {
  return (
    <div className="blog-timeline" aria-label="Posts">
      {posts.map((post) => {
        const title = postTitle(post);
        const cover = resolveCover(post);
        const meta = timelineMeta(post);
        const excerpt = timelineExcerpt(post);
        const thumbnail = cover ? timelineImageSrc(cover) : "";
        const showUnlisted = owner && post.status === "draft";

        return (
          <Link
            key={post.slug}
            className={`blog-timeline-row${thumbnail ? "" : " is-no-thumb"}`}
            href={blogPostPath(blog, post)}
            prefetch={true}
            style={postStyle(blog, post)}
          >
            <span className="blog-timeline-copy">
              <span className="blog-timeline-chip-row">
                <span className="blog-timeline-chip">
                  {TYPE_LABELS[post.type]}
                </span>
                {post.pinned && (
                  <span className="blog-timeline-marker">Pinned</span>
                )}
                {showUnlisted && (
                  <span className="blog-timeline-marker">Unlisted</span>
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
  posts,
  owner,
}: {
  blog: Blog;
  posts: Post[];
  owner: boolean;
}) {
  return (
    <div className="blog-index-list" aria-label="Posts">
      {posts.map((post) => {
        const showUnlisted = owner && post.status === "draft";
        return (
          <Link
            key={post.slug}
            className="blog-index-row"
            href={blogPostPath(blog, post)}
            prefetch={true}
            style={postStyle(blog, post)}
          >
            <span className="blog-index-title">{postTitle(post)}</span>
            <span className="blog-index-meta">
              {[formatArticleDate(post.date), TYPE_LABELS[post.type]]
                .filter(Boolean)
                .join(" / ")}
              {post.pinned ? " / Pinned" : ""}
              {showUnlisted ? " / Unlisted" : ""}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function BlogSingleHome({ blog, post }: { blog: Blog; post: Post }) {
  const ReaderComponent =
    post.type === "talk"
      ? TalkReader
      : post.type === "project"
        ? ProjectReader
        : Reader;

  return (
    <div className="blog-single-home">
      <ReaderComponent blog={blog} post={post} />
    </div>
  );
}

function BlogEmptyState({ layout }: { layout: Blog["homeLayout"] }) {
  if (layout === "timeline") return null;

  const copy =
    layout === "single"
      ? "Start writing. Save to get a link."
      : layout === "index"
        ? "Create the first page in this index."
        : "Add the first item to your collection.";

  return <p className="blog-home-empty">{copy}</p>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const blog = await getBlog(handle);
  if (!blog) return {};
  return {
    title: blog.name,
    description: blog.tagline,
    alternates: {
      types: blogFeedAlternateTypes(blog, blog.name),
    },
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
  // The desktop app tags its web view with this cookie (set natively before
  // the first request). It drops you straight into the workspace, so the
  // folder sidebar starts OPEN there unless you've explicitly collapsed it,
  // and the feeds footer is chrome the app doesn't need.
  const inWriteApp = cookieStore.get("wr_app")?.value === "1";
  const sidebarCookie = cookieStore.get(WORKSPACE_SIDEBAR_COOKIE)?.value;
  const initialSidebarCollapsed =
    sidebarCookie != null
      ? parseWorkspaceSidebarCollapsed(sidebarCookie)
      : !inWriteApp;
  if (redirectClaimed && blog.username) {
    const redirectParams = new URLSearchParams();
    for (const key of ["card", "folder", "layout"] as const) {
      const value = queryValue(query[key]);
      if (value) redirectParams.set(key, value);
    }
    const suffix = redirectParams.toString()
      ? `?${redirectParams.toString()}`
      : "";
    redirect(`${blogHomePath(blog)}${suffix}`);
  }
  const canEdit = access.canEdit;
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
  const [posts, folders, counts] = await Promise.all([
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
  const activeFolder =
    requestedFolder && requestedFolder !== "blog"
      ? folders.find((folder) => folder.path === requestedFolder) ?? null
      : null;
  const folderItemsPromise = activeFolder
    ? canEdit
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
  const singlePost =
    posts.find((post) => post.status === "published") ?? posts[0];
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

      {singlePost && displayBlog.homeLayout === "single" && (
        <BlogSingleHome blog={displayBlog} post={singlePost} />
      )}

      {posts.length > 0 && displayBlog.homeLayout === "timeline" && (
        <BlogTimeline
          blog={displayBlog}
          posts={posts}
          owner={canEdit}
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
            />
          ))}
        </div>
      )}

      {posts.length > 0 && displayBlog.homeLayout === "index" && (
        <BlogIndex blog={displayBlog} posts={posts} owner={canEdit} />
      )}

      {posts.length > 0 && !inWriteApp && (
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
      activeFolder={activeFolder ? activeFolder.path : "blog"}
      canManageFolders={canEdit}
      canManageSharing={canManageSharing}
      counts={counts}
      folders={folders}
      homePath={blogHomePath(blog)}
      initialSidebarCollapsed={initialSidebarCollapsed}
      showGuestSignIn={isGuestWorkspace && isAuthConfigured}
    >
      {activeFolder ? (
        <FolderPage
          blog={blog}
          folder={activeFolder}
          handle={handle}
          items={folderItems}
          canCreateItems={canEdit}
          canEditItems={canEdit || Boolean(activeFolderAccess?.canEditContent)}
        />
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
  return <BlogHomeForHandle handle={handle} searchParams={searchParams} />;
}
