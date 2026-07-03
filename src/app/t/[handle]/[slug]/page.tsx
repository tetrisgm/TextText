import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/session";
import {
  getAdjacentPublishedPosts,
  getAllPosts,
  getBlog,
  getPost,
  isBlogOwner,
} from "@/lib/store";
import type { AdjacentPublishedPosts } from "@/lib/store";
import type { Post } from "@/lib/content";
import { blogFeedAlternateTypes } from "@/lib/feed-links";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";
import { ProjectReader } from "@/components/ProjectReader";
import { PostEditLayer } from "@/components/PostEditLayer";
import { PostShortcuts } from "@/components/PostShortcuts";

interface Props {
  params: Promise<{ handle: string; slug: string }>;
  searchParams?: Promise<{ edit?: string | string[] }>;
}

const VISIBILITY_LABELS = {
  published: "Public",
  draft: "Unlisted",
} as const;

function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function postTitle(title: string): string {
  return title.trim() || "Untitled";
}

function postPath(handle: string, slug: string): string {
  return `/t/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`;
}

function blogPath(handle: string): string {
  return `/t/${encodeURIComponent(handle)}`;
}

function isEmptyOwnedPost(post: Post): boolean {
  const title = post.title.trim().toLowerCase();
  return (
    (!title || title === "untitled") &&
    !post.body.trim() &&
    !post.cover?.trim() &&
    !(post.gallery && post.gallery.length > 0) &&
    !post.videoUrl?.trim()
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 3L13 13M13 3L3 13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={dir === "left" ? "M10 3L5 8L10 13" : "M6 3L11 8L6 13"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OwnerTopControls({
  handle,
  slug,
  status,
}: {
  handle: string;
  slug: string;
  status: "draft" | "published";
}) {
  return (
    <div className="post-owner-controls applecms ac-chrome" aria-label="Post controls">
      <span className={`post-owner-visibility ac-toolbar-status is-${status}`}>
        {VISIBILITY_LABELS[status]}
      </span>
      <Link
        className="post-owner-edit ac-btn ac-btn-filled"
        href={`${postPath(handle, slug)}?edit=1`}
      >
        Edit
      </Link>
    </div>
  );
}

function PostTopActionBar({ children }: { children: ReactNode }) {
  return <div className="post-top-action-bar">{children}</div>;
}

function PostDetailControls({
  handle,
  adjacent,
  closeHref,
  closeLabel = "Close",
  showAdjacent = true,
}: {
  handle: string;
  adjacent: AdjacentPublishedPosts;
  closeHref: string;
  closeLabel?: string;
  showAdjacent?: boolean;
}) {
  return (
    <nav className="post-detail-controls" aria-label="Post navigation">
      {showAdjacent && adjacent.previous && (
        <Link
          className="post-detail-nav"
          href={postPath(handle, adjacent.previous.slug)}
          aria-label={`Previous post: ${postTitle(adjacent.previous.title)}`}
        >
          <span className="post-detail-control-icon">
            <ChevronIcon dir="left" />
          </span>
        </Link>
      )}
      {showAdjacent && adjacent.next && (
        <Link
          className="post-detail-nav"
          href={postPath(handle, adjacent.next.slug)}
          aria-label={`Next post: ${postTitle(adjacent.next.title)}`}
        >
          <span className="post-detail-control-icon">
            <ChevronIcon dir="right" />
          </span>
        </Link>
      )}
      <Link className="post-detail-close" href={closeHref} aria-label={closeLabel}>
        <span className="post-detail-control-icon">
          <CloseIcon />
        </span>
      </Link>
    </nav>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, slug } = await params;
  const [blog, post] = await Promise.all([
    getBlog(handle),
    getPost(handle, slug),
  ]);
  if (!blog || !post) return {};
  const metadata: Metadata = {
    title: `${postTitle(post.title)} · ${blog.name}`,
    description: post.body.split(/\n{2,}/)[0]?.slice(0, 160),
    alternates: {
      types: blogFeedAlternateTypes(handle, blog.name),
    },
  };
  if (post.status !== "published") {
    metadata.robots = { index: false, follow: false };
  }
  return metadata;
}

export default async function PostPage({ params, searchParams }: Props) {
  const { handle, slug } = await params;
  const [blog, post, viewer] = await Promise.all([
    getBlog(handle),
    getPost(handle, slug),
    getCurrentUser(),
  ]);
  const query = searchParams ? await searchParams : {};
  if (!blog || !post) notFound();
  const owner = viewer ? await isBlogOwner(handle, viewer.sub) : false;
  const editMode = owner && queryValue(query.edit) === "1";
  const currentPostPath = postPath(handle, post.slug);
  const homePath = blogPath(handle);

  if (owner && !editMode && isEmptyOwnedPost(post)) {
    redirect(`${currentPostPath}?edit=1`);
  }

  const [adjacent, usedSlugs] = await Promise.all([
    getAdjacentPublishedPosts(handle, post.slug),
    editMode
      ? getAllPosts(handle).then((posts) =>
          posts
            .filter((candidate) =>
              post.id ? candidate.id !== post.id : candidate.slug !== post.slug,
            )
            .map((candidate) => candidate.slug),
        )
      : Promise.resolve([]),
  ]);

  const ReaderComponent =
    post.type === "talk"
      ? TalkReader
      : post.type === "project"
        ? ProjectReader
        : Reader;

  if (editMode) {
    return (
      <>
        <PostTopActionBar>
          <PostDetailControls
            handle={handle}
            adjacent={adjacent}
            closeHref={currentPostPath}
            closeLabel="Done"
            showAdjacent={false}
          />
        </PostTopActionBar>
        <PostShortcuts
          homePath={homePath}
          previousPath={
            adjacent.previous ? postPath(handle, adjacent.previous.slug) : undefined
          }
          nextPath={adjacent.next ? postPath(handle, adjacent.next.slug) : undefined}
          owner={owner}
        />
        <PostEditLayer blog={blog} post={post} usedSlugs={usedSlugs} />
      </>
    );
  }

  return (
    <>
      <PostTopActionBar>
        {owner && (
          <OwnerTopControls handle={handle} slug={post.slug} status={post.status} />
        )}
        <PostDetailControls
          handle={handle}
          adjacent={adjacent}
          closeHref={homePath}
        />
      </PostTopActionBar>
      <PostShortcuts
        homePath={homePath}
        previousPath={
          adjacent.previous ? postPath(handle, adjacent.previous.slug) : undefined
        }
        nextPath={adjacent.next ? postPath(handle, adjacent.next.slug) : undefined}
        owner={owner}
      />
      <ReaderComponent blog={blog} post={post} />
    </>
  );
}
