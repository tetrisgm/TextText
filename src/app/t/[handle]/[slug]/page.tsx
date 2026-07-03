import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import {
  getAdjacentPublishedPosts,
  getAllPosts,
  getBlog,
  getPost,
  isBlogOwner,
} from "@/lib/store";
import type { AdjacentPublishedPosts } from "@/lib/store";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";
import { ProjectReader } from "@/components/ProjectReader";
import { PostEditLayer } from "@/components/PostEditLayer";

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

function OwnerPostControls({
  handle,
  slug,
  status,
}: {
  handle: string;
  slug: string;
  status: "draft" | "published";
}) {
  return (
    <div className="post-owner-floating" aria-label="Post controls">
      <span className={`post-owner-visibility is-${status}`}>
        {VISIBILITY_LABELS[status]}
      </span>
      <Link className="post-owner-edit" href={`${postPath(handle, slug)}?edit=1`}>
        Edit
      </Link>
    </div>
  );
}

function PostTopNav({
  handle,
  adjacent,
}: {
  handle: string;
  adjacent: AdjacentPublishedPosts;
}) {
  return (
    <nav className="post-top-nav" aria-label="Post navigation">
      <div className="post-top-nav-inner">
        <Link className="post-top-back" href={`/t/${encodeURIComponent(handle)}`}>
          <span aria-hidden="true">←</span>
          <span>Back</span>
        </Link>
        <div className="post-top-adjacent" aria-label="Adjacent posts">
          {adjacent.previous && (
            <Link
              className="post-top-adjacent-link"
              href={postPath(handle, adjacent.previous.slug)}
              aria-label={`Previous post: ${postTitle(adjacent.previous.title)}`}
            >
              Prev
            </Link>
          )}
          {adjacent.next && (
            <Link
              className="post-top-adjacent-link"
              href={postPath(handle, adjacent.next.slug)}
              aria-label={`Next post: ${postTitle(adjacent.next.title)}`}
            >
              Next
            </Link>
          )}
        </div>
      </div>
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
        <PostTopNav handle={handle} adjacent={adjacent} />
        <PostEditLayer blog={blog} post={post} usedSlugs={usedSlugs} />
      </>
    );
  }

  return (
    <>
      <PostTopNav handle={handle} adjacent={adjacent} />
      {owner && (
        <OwnerPostControls handle={handle} slug={post.slug} status={post.status} />
      )}
      <ReaderComponent blog={blog} post={post} />
    </>
  );
}
