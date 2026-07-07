import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { isAuthConfigured } from "@/auth";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { getCurrentUser } from "@/lib/session";
import { postShareRoleFor } from "@/lib/shares";
import {
  getAdjacentPublishedPosts,
  getAllPosts,
  getBlog,
  getFolderCounts,
  getFolders,
  getPost,
  getPostById,
} from "@/lib/store";
import type { Post } from "@/lib/content";
import { blogFeedAlternateTypes } from "@/lib/feed-links";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";
import { ProjectReader } from "@/components/ProjectReader";
import { PostActionBar } from "@/components/PostActionBar";
import { PostEditLayer } from "@/components/PostEditLayer";
import { PostReadWorkspaceShell } from "@/components/PostWorkspaceShell";
import { PostShortcuts } from "@/components/PostShortcuts";
import { isNoCoverValue } from "@/lib/cover";
import { blogHomePath, blogPostEditPath, blogPostPath } from "@/lib/public-paths";
import {
  WORKSPACE_SIDEBAR_COOKIE,
  parseWorkspaceSidebarCollapsed,
} from "@/lib/workspace-sidebar-state";

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

// Notes and bookmarks are unlisted forever: they exist only inside the
// owner's workspace and must 404 for everyone else.
function isUnlistedItem(post: Post): boolean {
  return post.type === "note" || post.type === "bookmark";
}

function isEmptyOwnedPost(post: Post): boolean {
  const title = post.title.trim().toLowerCase();
  return (
    (!title || title === "untitled") &&
    !post.excerpt?.trim() &&
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
  // Never describe an unlisted note or bookmark in page metadata; the page
  // itself 404s for anyone who cannot edit.
  if (isUnlistedItem(post)) return {};
  const metadata: Metadata = {
    title: `${postTitle(post.title)} · ${blog.name}`,
    description:
      post.excerpt?.trim() || post.body.split(/\n{2,}/)[0]?.slice(0, 160),
    alternates: {
      types: blogFeedAlternateTypes(blog, blog.name),
    },
  };
  if (post.status !== "published") {
    metadata.robots = { index: false, follow: false };
  }
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
  const [blog, postBySlug, access, query, cookieStore] = await Promise.all([
    getBlog(handle),
    getPost(handle, slug),
    getBlogEditAccess(handle),
    queryPromise,
    cookies(),
  ]);
  if (!blog) notFound();
  const initialSidebarCollapsed = parseWorkspaceSidebarCollapsed(
    cookieStore.get(WORKSPACE_SIDEBAR_COOKIE)?.value,
  );
  const canEdit = access.canEdit;
  const editRequested = queryValue(query.edit) === "1";
  const editId = queryValue(query.id);
  let post = postBySlug;

  if (!post && canEdit && editRequested && editId) {
    post = await getPostById(handle, editId);
    if (post) redirect(blogPostEditPath(blog, post));
  }

  if (!post) notFound();
  // Item shares (the Notion model): an invited person reaches exactly this
  // post. "editor" unlocks the edit layer for it; "viewer" only unhides an
  // unlisted item. Both leave the rest of the workspace invisible.
  let shareRole: Awaited<ReturnType<typeof postShareRoleFor>> = null;
  if (!canEdit && post.id) {
    const viewer = await getCurrentUser();
    if (viewer) shareRole = await postShareRoleFor(viewer, post.id);
  }
  if (isUnlistedItem(post) && !canEdit && !shareRole) notFound();
  const canEditPost = canEdit || shareRole === "editor";
  const editMode = canEditPost && editRequested;
  if (redirectClaimed && blog.username) {
    const path = blogPostPath(blog, post);
    redirect(
      editMode
        ? blogPostEditPath(blog, post)
        : editRequested
          ? `${path}?edit=1`
          : path,
    );
  }

  const currentPostPath = blogPostPath(blog, post);
  const homePath = blogHomePath(blog);
  const showGuestSignIn =
    canEdit && access.isUnclaimed && access.isTokenEditor && isAuthConfigured;

  if (editMode && post.id && editId !== post.id) {
    redirect(blogPostEditPath(blog, post));
  }

  if (canEdit && !editMode && isEmptyOwnedPost(post)) {
    redirect(blogPostEditPath(blog, post));
  }

  const [adjacent, allPosts, folders, counts] = await Promise.all([
    getAdjacentPublishedPosts(handle, post.slug),
    canEdit ? getAllPosts(handle) : Promise.resolve([]),
    canEdit ? getFolders(handle) : Promise.resolve([]),
    canEdit ? getFolderCounts(handle) : Promise.resolve({}),
  ]);
  const usedSlugs = editMode
    ? allPosts
        .filter((candidate) =>
          post.id ? candidate.id !== post.id : candidate.slug !== post.slug,
        )
        .map((candidate) => candidate.slug)
    : [];

  const ReaderComponent =
    post.type === "talk"
      ? TalkReader
      : post.type === "project"
        ? ProjectReader
        : Reader;

  if (editMode) {
    return (
      <>
        <PostShortcuts
          homePath={homePath}
          previousPath={
            adjacent.previous
              ? blogPostPath(blog, { slug: adjacent.previous.slug })
              : undefined
          }
          nextPath={
            adjacent.next ? blogPostPath(blog, { slug: adjacent.next.slug }) : undefined
          }
          owner={canEdit}
          handle={handle}
        />
        <PostEditLayer
          key={post.id ?? post.slug}
          blog={blog}
          post={post}
          adjacent={adjacent}
          homePath={homePath}
          mediaEnabled={access.isOwner}
          counts={counts}
          folders={folders}
          initialSidebarCollapsed={initialSidebarCollapsed}
          usedSlugs={usedSlugs}
        />
      </>
    );
  }

  const reader = <ReaderComponent blog={blog} post={post} />;

  return (
    <>
      {canEdit ? (
        <PostReadWorkspaceShell
          adjacent={adjacent}
          blog={blog}
          counts={counts}
          folders={folders}
          homePath={homePath}
          initialSidebarCollapsed={initialSidebarCollapsed}
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
          />
          {reader}
        </>
      )}
      <PostShortcuts
        homePath={homePath}
        previousPath={
          adjacent.previous
            ? blogPostPath(blog, { slug: adjacent.previous.slug })
            : undefined
        }
        nextPath={
          adjacent.next ? blogPostPath(blog, { slug: adjacent.next.slug }) : undefined
        }
        owner={canEdit}
        handle={handle}
      />
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
