import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import {
  getAdjacentPublishedPosts,
  getAllPosts,
  getBlog,
  getPost,
  isBlogOwner,
} from "@/lib/store";
import type { Post } from "@/lib/content";
import { blogFeedAlternateTypes } from "@/lib/feed-links";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";
import { ProjectReader } from "@/components/ProjectReader";
import { PostActionBar } from "@/components/PostActionBar";
import { PostEditLayer } from "@/components/PostEditLayer";
import { PostShortcuts } from "@/components/PostShortcuts";

interface Props {
  params: Promise<{ handle: string; slug: string }>;
  searchParams?: Promise<{ edit?: string | string[] }>;
}

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
        <PostShortcuts
          homePath={homePath}
          previousPath={
            adjacent.previous ? postPath(handle, adjacent.previous.slug) : undefined
          }
          nextPath={adjacent.next ? postPath(handle, adjacent.next.slug) : undefined}
          owner={owner}
        />
        <PostEditLayer
          blog={blog}
          post={post}
          adjacent={adjacent}
          homePath={homePath}
          usedSlugs={usedSlugs}
        />
      </>
    );
  }

  return (
    <>
      <PostActionBar
        mode="read"
        owner={owner}
        blog={blog}
        post={post}
        adjacent={adjacent}
        homePath={homePath}
        postPath={currentPostPath}
      />
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
